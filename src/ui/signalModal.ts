import { Modal, Notice, TFile, setIcon } from 'obsidian';
import type InvestmentPlugin from '../main';
import { fmtPercent } from '../utils/format';
import type { SignalItem, SignalStatus } from '../services/signalAlerts';
import type { HoldingSummary, NetWorthRecord, ResolvedTransaction } from '../types';
import { fetchFundNavHistory } from '../services/stockSdk';
import { getFirstRecordInner, parseRecordSource } from '../utils/recordParser';
import { resolvePending, summarizeHolding, toNavByDate } from '../utils/returnCalc';
import { appendTxToFile } from '../utils/recordMutation';
import { todayEstimateNav } from '../utils/estimateNav';
import { PositionTradeModal } from './positionTradeModal';
import { resolveAvailableShares } from '../services/positionHolding';
import type { PositionTarget } from '../services/positionTargets';
import {
	buildChannelOption,
	DEFAULT_CHANNEL_CONFIG,
	type TrendChannelConfigValues,
} from './charts/trendChannel';
import { disposeChart, initChart, type ChartInstance } from './charts/echartsInit';
import { HoldingsValuationView } from './holdingsValuationView';

/** 右侧通道图所需的数据（按单只基金从文件实时解析） */
interface ChannelData {
	navHistory: NetWorthRecord[];
	resolved: ResolvedTransaction[];
	summary: HoldingSummary | null;
}

/**
 * 买卖信号处理弹窗：左列为信号列表，右列页签切换「趋势通道图 / 持仓估值三图」。
 * 每条信号可"忽略 / 确认"，确认会打开快捷交易弹窗并写回该基金买卖记录；
 * 关闭按钮使用 Obsidian 原生（右上角），不在标题栏重复放置。
 */
export class SignalModal extends Modal {
	private readonly plugin: InvestmentPlugin;
	private readonly signals: SignalItem[];
	private listEl: HTMLElement | null = null;
	private chartCol: HTMLElement | null = null;
	private chart: ChartInstance | null = null;
	/** 右列持仓估值视图（PE/PB/PE×PB 联动三图 + 手动补充录入），与指标分析弹窗共用实现 */
	private readonly holdingsView: HoldingsValuationView;

	private tabsEl: HTMLElement | null = null;
	private channelPaneEl: HTMLElement | null = null;
	private holdingsPaneEl: HTMLElement | null = null;
	private activeTab: 'channel' | 'holdings' = 'channel';
	/** 当前「分析」选中的基金代码、笔记路径与名称；null = 尚未选择，持仓分析页签显示引导 */
	private currentCode: string | null = null;
	private currentFilePath: string | null = null;
	private currentName: string | null = null;

	constructor(plugin: InvestmentPlugin, signals: SignalItem[]) {
		super(plugin.app);
		this.plugin = plugin;
		this.signals = signals;
		this.holdingsView = new HoldingsValuationView(plugin);
	}

	onOpen(): void {
		this.modalEl.addClass('inv-signal-modal');
		const { contentEl } = this;

		const layout = contentEl.createDiv({ cls: 'inv-signal-layout' });

		const main = layout.createDiv({ cls: 'inv-signal-main' });
		const header = main.createDiv({ cls: 'inv-signal-header' });
		header.createSpan({ text: '今日买卖信号', cls: 'inv-signal-title' });

		this.listEl = main.createDiv({ cls: 'inv-signal-list' });
		this.renderList();

		this.chartCol = layout.createDiv({ cls: 'inv-signal-chart' });

		// 右列页签（复用指标分析弹窗的药丸页签样式）
		this.tabsEl = this.chartCol.createDiv({ cls: 'inv-chart-tabs inv-channel-tabs' });
		const channelTab = this.tabsEl.createDiv({ cls: 'inv-chart-tab active', text: '趋势通道' });
		channelTab.setAttribute('data-tab', 'channel');
		const holdingsTab = this.tabsEl.createDiv({ cls: 'inv-chart-tab', text: '持仓分析' });
		holdingsTab.setAttribute('data-tab', 'holdings');
		channelTab.addEventListener('click', () => this.setTab('channel'));
		holdingsTab.addEventListener('click', () => this.setTab('holdings'));

		this.channelPaneEl = this.chartCol.createDiv({ cls: 'inv-channel-pane' });
		this.holdingsPaneEl = this.chartCol.createDiv({
			cls: 'inv-channel-pane inv-channel-pane-holdings is-hidden',
		});
		this.renderChartPlaceholder();
	}

	onClose(): void {
		disposeChart(this.chart);
		this.chart = null;
		this.holdingsView.dispose();
		this.contentEl.empty();
	}

	/** 右列页签切换：隐藏容器内不初始化 echarts（尺寸为 0），切入时按需渲染 */
	private setTab(tab: 'channel' | 'holdings'): void {
		if (this.activeTab === tab) return;
		this.activeTab = tab;
		this.channelPaneEl?.classList.toggle('is-hidden', tab !== 'channel');
		this.holdingsPaneEl?.classList.toggle('is-hidden', tab !== 'holdings');
		this.tabsEl?.querySelectorAll('.inv-chart-tab').forEach((el) => {
			el.classList.toggle('active', el.getAttribute('data-tab') === tab);
		});
		if (tab === 'holdings') {
			const pane = this.holdingsPaneEl;
			if (!pane) return;
			if (this.currentCode) {
				this.holdingsView.render(
					pane,
					this.currentCode,
					this.currentFilePath ?? '',
					this.currentName ?? this.currentCode,
					true,
				);
			} else {
				this.holdingsView.dispose();
				pane.empty();
				pane.createEl('p', {
					text: '请先点击左侧信号卡片的「分析」加载基金。',
					cls: 'inv-chart-empty',
				});
			}
		} else {
			// 切回趋势通道：隐藏期间容器尺寸可能变化，修正一次
			this.chart?.resize();
		}
	}

	private getStatus(code: string): SignalStatus | null {
		return this.plugin.getSignalStatus(code);
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();

		const unhandled = this.signals.filter((s) => this.getStatus(s.code) === null).length;

		for (const s of this.signals) {
			const status = this.getStatus(s.code);
			const isBuy = s.type === 'buy';
			const color = isBuy ? 'var(--text-error)' : 'var(--text-success)';
			const bg = isBuy
				? 'color-mix(in srgb, var(--text-error) 12%, transparent)'
				: 'color-mix(in srgb, var(--text-success) 12%, transparent)';

			const card = list.createDiv({ cls: 'inv-signal-card' });
			if (!status) card.addClass('unhandled');

			const head = card.createDiv({ cls: 'inv-signal-card-head' });
			const nameWrap = head.createDiv({ cls: 'inv-signal-card-name-wrap' });
			nameWrap.createSpan({ cls: 'inv-signal-dot' }).style.backgroundColor = color;
			nameWrap.createSpan({ text: s.name, cls: 'inv-signal-card-name' });
			nameWrap.createSpan({ text: s.code, cls: 'inv-signal-card-code' });

			// 分析通道：在右侧加载该基金趋势通道图
			const analyse = head.createEl('button', {
				cls: 'inv-signal-analyse',
				attr: { type: 'button', 'aria-label': '分析通道', title: '查看趋势通道' },
			});
			setIcon(analyse, 'chart-area');
			analyse.addEventListener('click', () => void this.showChannel(s));

			if (status === 'confirmed') {
				head.createSpan({ text: '已确认', cls: 'inv-signal-status confirmed' });
			} else if (status === 'ignored') {
				head.createSpan({ text: '已忽略', cls: 'inv-signal-status ignored' });
			} else {
				const chip = head.createSpan({ text: isBuy ? '买入信号' : '卖出信号', cls: 'inv-signal-type' });
				chip.style.setProperty('color', color);
				chip.style.setProperty('background', bg);
			}

			const rows = card.createDiv({ cls: 'inv-signal-rows' });
			this.row(rows, '最新估值', s.latestNav.toFixed(4));
			this.row(
				rows,
				s.costPct < 0 ? '低于持仓成本线' : '高于持仓成本线',
				fmtPercent(s.costPct / 100, 2, true),
				s.costPct < 0 ? 'var(--text-success)' : 'var(--text-error)',
			);
			if (s.cumulativeCost != null && s.cumCostPct != null) {
				this.row(
					rows,
					s.cumCostPct < 0 ? '低于累计成本线' : '高于累计成本线',
					fmtPercent(s.cumCostPct / 100, 2, true),
					s.cumCostPct < 0 ? 'var(--text-success)' : 'var(--text-error)',
				);
			}

			if (!status) {
				const actions = card.createDiv({ cls: 'inv-signal-actions' });
				const ignore = actions.createEl('button', { text: '忽略', cls: 'inv-signal-btn ignore', attr: { type: 'button' } });
				ignore.addEventListener('click', () => {
					this.plugin.markSignal(s.code, 'ignored');
					this.renderList();
				});
				const confirm = actions.createEl('button', { text: isBuy ? '确认买入' : '确认卖出', cls: 'inv-signal-btn confirm', attr: { type: 'button' } });
				confirm.style.backgroundColor = color;
				confirm.addEventListener('click', () => this.confirmAndTrade(s));
			}
		}

		const footHint = list.createDiv({ cls: 'inv-signal-foot' });
		footHint.setText(
			unhandled > 0
				? `${unhandled} 条待处理 · 确认将打开记录弹窗，忽略仅当天有效`
				: '今日信号已全部处理 · 确认/忽略仅当天有效，次日自动重置',
		);
	}

	private confirmAndTrade(s: SignalItem): void {
		// 统一弹窗：目标锁定为该信号基金，类型默认跟随信号（买入/卖出），用户可改
		const target: PositionTarget = {
			kind: 'fund',
			code: s.code,
			name: s.name,
			filePath: s.filePath,
		};
		new PositionTradeModal(
			this.plugin,
			{
				target,
				targetLocked: true,
				type: s.type === 'buy' ? 'buy' : 'sell',
				resolveAvailableShares: (t) => resolveAvailableShares(this.plugin.app, t),
			},
			async (tx) => {
				const file = this.plugin.app.vault.getAbstractFileByPath(s.filePath);
				if (!(file instanceof TFile)) {
					const msg = '找不到基金文件，无法写入交易记录';
					new Notice(msg);
					throw new Error(msg); // 让弹窗知道写回失败，保留已填内容
				}
				try {
					await appendTxToFile(this.plugin.app, file, [tx]);
					// 写回后标记该信号已确认；持仓变化由文件的 change 事件驱动数据流刷新
					this.plugin.markSignal(s.code, 'confirmed');
					this.renderList();
				} catch (e) {
					new Notice(`记录买入/卖出失败：${e instanceof Error ? e.message : String(e)}`);
					throw e;
				}
			},
		).open();
	}

	// ---------- 右侧通道分析 ----------

	private renderChartPlaceholder(): void {
		const pane = this.channelPaneEl;
		if (!pane) return;
		pane.empty();
		pane.createDiv({ text: '点击信号卡片的「分析」查看趋势通道', cls: 'inv-signal-chart-hint' });
	}

	private async showChannel(item: SignalItem): Promise<void> {
		const pane = this.channelPaneEl;
		if (!pane) return;
		disposeChart(this.chart);
		this.chart = null;
		this.currentCode = item.code;
		this.currentFilePath = item.filePath;
		this.currentName = item.name;
		// 点击「分析」即选中该基金并展示趋势通道；持仓分析页签下次切入时按 currentCode 渲染
		this.setTab('channel');
		pane.empty();
		pane.createDiv({ text: '加载通道…', cls: 'inv-signal-chart-hint' });
		try {
			const d = await this.loadChannelData(item);
			if (!this.channelPaneEl?.isConnected) return;
			this.renderChannel(pane, item, d);
		} catch (e) {
			pane.empty();
			pane.createDiv({
				text: `通道加载失败：${e instanceof Error ? e.message : String(e)}`,
				cls: 'inv-signal-chart-hint',
			});
		}
	}

	private async loadChannelData(item: SignalItem): Promise<ChannelData> {
		const navHistory = await fetchFundNavHistory(item.code);
		let resolved: ResolvedTransaction[] = [];
		let summary: HoldingSummary | null = null;
		const file = this.plugin.app.vault.getAbstractFileByPath(item.filePath);
		if (file instanceof TFile) {
			const content = await this.plugin.app.vault.read(file);
			const inner = getFirstRecordInner(content);
			if (inner != null) {
				const parsed = parseRecordSource(inner);
				resolved = resolvePending(parsed.entries.map((e) => e.tx), toNavByDate(navHistory));
				summary = summarizeHolding(resolved, navHistory);
			}
		}
		return { navHistory, resolved, summary };
	}

	private renderChannel(pane: HTMLElement, item: SignalItem, d: ChannelData): void {
		pane.empty();
		const title = pane.createDiv({ cls: 'inv-signal-chart-title' });
		title.createSpan({ text: item.name, cls: 'inv-signal-chart-name' });
		title.createSpan({ text: item.code, cls: 'inv-signal-chart-code' });
		const chartEl = pane.createDiv({ cls: 'inv-signal-chart-embed' });
		if (d.navHistory.length === 0) {
			chartEl.createEl('p', { text: '暂无净值数据', cls: 'inv-signal-chart-empty' });
			return;
		}
		const estimatedNav = todayEstimateNav(this.plugin.store.snapshot.estimates, item.code);
		const holdingCost =
			d.summary && d.summary.avgCostPerShare > 0 ? d.summary.avgCostPerShare : null;
		// 累计成本 = 累计投入 / 持有份额；d.summary 可能为 null 或未持仓
		const cumulativeCost =
			d.summary && d.summary.holdShares > 0
				? d.summary.totalInvested / d.summary.holdShares
				: null;
		this.chart = initChart(
			chartEl,
			buildChannelOption(
				d.navHistory,
				this.getChannelConfig(item.code),
				d.resolved,
				estimatedNav,
				holdingCost,
				cumulativeCost,
			),
		);
		this.chart.resize();
		// 弹窗动画后修正一次尺寸，避免初始化时容器宽度为 0
		window.setTimeout(() => this.chart?.resize(), 60);
	}

	private getChannelConfig(code: string): TrendChannelConfigValues {
		return { ...DEFAULT_CHANNEL_CONFIG, ...(this.plugin.settings.trendChannelConfig[code] ?? {}) };
	}

	private row(
		parent: HTMLElement,
		label: string,
		value: string,
		valueColor?: string,
	): void {
		const r = parent.createDiv({ cls: 'inv-signal-row' });
		r.createSpan({ text: label, cls: 'inv-signal-row-label' });
		const v = r.createSpan({ text: value, cls: 'inv-signal-row-value' });
		if (valueColor) v.style.color = valueColor;
	}
}