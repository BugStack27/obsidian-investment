import { Modal } from 'obsidian';
import type InvestmentPlugin from '../main';
import { computeTrendChannelSignal } from '../utils/signalCalc';
import {
	buildChannelOption,
	DEFAULT_CHANNEL_CONFIG,
	type TrendChannelConfigValues,
	CHANNEL_AVG_TYPE_OPTIONS,
	CHANNEL_STD_TYPE_OPTIONS,
	CHANNEL_AVG_PRESETS,
} from './charts/trendChannel';
import { disposeChart, initChart, type ChartInstance } from './charts/echartsInit';
import { HoldingsValuationView } from './holdingsValuationView';
import { todayEstimateNav } from '../utils/estimateNav';
import { listHeldFunds, type FundAnalysisData } from '../services/fundAnalysis';

export interface ChannelModalProps {
	/** 打开时默认选中的基金代码；为 null 或不在持仓列表中时回退为列表第一只 */
	initialCode: string | null;
}

type ChannelTab = 'channel' | 'holdings';

/**
 * 指标（通道）分析弹窗：左栏持仓基金列表 + 右栏「趋势通道 / 持仓分析」页签。
 * 打开时一次性加载全部持仓基金明细，点击左栏即可在弹窗内快速切换基金横向对比。
 * 持仓分析页签懒加载：首次进入才拉取该基金重仓股行情，按基金在弹窗实例内缓存。
 * 复刻 invest-app 移动端 IndicatorAnalysisDialog 的呈现方式。
 */
export class ChannelModal extends Modal {
	private readonly plugin: InvestmentPlugin;
	private readonly props: ChannelModalProps;
	private chart: ChartInstance | null = null;
	private funds: FundAnalysisData[] = [];
	private current: FundAnalysisData | null = null;
	/** 持仓估值视图（录入行 + PE/PB/PE×PB 三图），与买卖信号弹窗共用实现 */
	private readonly holdingsView: HoldingsValuationView;

	private sidebarEl: HTMLElement | null = null;
	private mainEl: HTMLElement | null = null;
	private tabsEl: HTMLElement | null = null;
	private channelPaneEl: HTMLElement | null = null;
	private holdingsPaneEl: HTMLElement | null = null;
	private paramsEl: HTMLElement | null = null;
	private signalEl: HTMLElement | null = null;
	private chartEl: HTMLElement | null = null;

	private activeTab: ChannelTab = 'channel';
	constructor(plugin: InvestmentPlugin, props: ChannelModalProps) {
		super(plugin.app);
		this.plugin = plugin;
		this.props = props;
		this.holdingsView = new HoldingsValuationView(plugin);
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass('inv-channel-modal');
		const { contentEl } = this;

		const layout = contentEl.createDiv({ cls: 'inv-channel-layout' });
		this.sidebarEl = layout.createDiv({ cls: 'inv-channel-sidebar' });
		this.mainEl = layout.createDiv({ cls: 'inv-channel-main' });

		this.tabsEl = this.mainEl.createDiv({ cls: 'inv-chart-tabs inv-channel-tabs' });
		const channelTab = this.tabsEl.createDiv({ cls: 'inv-chart-tab active', text: '趋势通道' });
		channelTab.setAttribute('data-tab', 'channel');
		const holdingsTab = this.tabsEl.createDiv({ cls: 'inv-chart-tab', text: '持仓分析' });
		holdingsTab.setAttribute('data-tab', 'holdings');
		channelTab.addEventListener('click', () => this.setTab('channel'));
		holdingsTab.addEventListener('click', () => this.setTab('holdings'));

		this.channelPaneEl = this.mainEl.createDiv({ cls: 'inv-channel-pane inv-channel-pane-channel' });
		this.paramsEl = this.channelPaneEl.createDiv({ cls: 'inv-chart-params inv-modal-params' });
		this.signalEl = this.channelPaneEl.createDiv({ cls: 'inv-chart-signal' });
		this.chartEl = this.channelPaneEl.createDiv({ cls: 'inv-chart-body inv-channel-chart' });

		this.holdingsPaneEl = this.mainEl.createDiv({
			cls: 'inv-channel-pane inv-channel-pane-holdings is-hidden',
		});

		this.sidebarEl.createDiv({ cls: 'inv-channel-sidebar-hint', text: '加载中…' });

		const funds = await listHeldFunds(this.plugin.app);
		// 加载期间弹窗可能已被关闭
		if (!this.mainEl.isConnected) return;
		this.funds = funds;

		this.renderSidebar();
		const initial =
			funds.find((f) => f.code === this.props.initialCode) ?? funds[0] ?? null;
		if (initial) this.select(initial.code);
		else this.renderEmptyState();

		// 弹窗动画后修正一次图表尺寸，避免初始化时宽度测量为 0
		window.setTimeout(() => this.chart?.resize(), 60);
	}

	onClose(): void {
		disposeChart(this.chart);
		this.chart = null;
		this.holdingsView.dispose();
		this.funds = [];
		this.current = null;
		this.contentEl.empty();
	}

	/** 左栏：持仓基金名列表（仅名称），当前项高亮 */
	private renderSidebar(): void {
		const sidebar = this.sidebarEl;
		if (!sidebar) return;
		sidebar.empty();

		if (this.funds.length === 0) {
			sidebar.createDiv({ cls: 'inv-channel-sidebar-hint', text: '暂无持仓基金' });
			return;
		}

		for (const fund of this.funds) {
			const item = sidebar.createDiv({ cls: 'inv-channel-fund-item', text: fund.name });
			item.setAttribute('data-code', fund.code);
			item.setAttribute('title', fund.name);
			item.addEventListener('click', () => this.select(fund.code));
		}
	}

	/** 切换当前基金：更新左栏高亮并重绘右栏 */
	private select(code: string): void {
		const fund = this.funds.find((f) => f.code === code);
		if (!fund) return;
		this.current = fund;

		this.sidebarEl?.querySelectorAll('.inv-channel-fund-item').forEach((el) => {
			el.classList.toggle('active', el.getAttribute('data-code') === code);
		});
		this.renderMain();
	}

	/** 页签切换：隐藏容器内的图表不初始化（尺寸为 0），切回时按需重建 */
	private setTab(tab: ChannelTab): void {
		if (this.activeTab === tab) return;
		this.activeTab = tab;
		this.channelPaneEl?.classList.toggle('is-hidden', tab !== 'channel');
		this.holdingsPaneEl?.classList.toggle('is-hidden', tab !== 'holdings');
		this.tabsEl?.querySelectorAll('.inv-chart-tab').forEach((el) => {
			el.classList.toggle('active', el.getAttribute('data-tab') === tab);
		});
		if (tab === 'holdings') {
			this.renderHoldings();
		} else if (this.chartEl) {
			// 持仓页签期间通道图未初始化（chart 为 null），此处重建
			this.renderChannel(this.chartEl);
		}
	}

	private renderMain(): void {
		const fund = this.current;
		if (!fund) return;
		this.buildParamControls();
		if (this.signalEl) this.renderSignal(this.signalEl);
		if (this.chartEl) this.renderChannel(this.chartEl);
		if (this.activeTab === 'holdings') this.renderHoldings();
	}

	/** 无持仓基金时的右栏占位 */
	private renderEmptyState(): void {
		this.tabsEl?.addClass('is-hidden');
		this.paramsEl?.empty();
		this.signalEl?.empty();
		this.chartEl?.empty();
		this.holdingsPaneEl?.empty();
		this.chartEl?.createEl('p', {
			text: '暂无持仓基金（持有份额 > 0）。请先在基金笔记中记录买入，再打开本弹窗。',
			cls: 'inv-chart-empty',
		});
	}

	private getConfig(): TrendChannelConfigValues {
		const code = this.current?.code;
		return code
			? { ...DEFAULT_CHANNEL_CONFIG, ...this.plugin.settings.trendChannelConfig[code] }
			: { ...DEFAULT_CHANNEL_CONFIG };
	}

	private persistConfig(config: TrendChannelConfigValues): void {
		const code = this.current?.code;
		if (!code) return;
		this.plugin.settings.trendChannelConfig = {
			...this.plugin.settings.trendChannelConfig,
			[code]: { ...config },
		};
		void this.plugin.saveSettings();
	}

	private applyConfig(mutate: (cfg: TrendChannelConfigValues) => void): void {
		const cfg = this.getConfig();
		mutate(cfg);
		this.persistConfig(cfg);
		if (this.signalEl) this.renderSignal(this.signalEl);
		if (this.chartEl) this.renderChannel(this.chartEl);
	}

	/**
	 * 成本口径（与卡片/信号一致）：
	 * 持仓成本 = 加权平均买入成本；累计成本 = 累计投入 / 持有份额（无持仓为 null）。
	 */
	private costInfo(fund: FundAnalysisData): { holdingCost: number; cumulativeCost: number | null } {
		return {
			holdingCost: fund.summary.avgCostPerShare,
			cumulativeCost:
				fund.summary.holdShares > 0 ? fund.summary.totalInvested / fund.summary.holdShares : null,
		};
	}

	private renderSignal(el: HTMLElement): void {
		el.empty();
		const fund = this.current;
		if (!fund || fund.navHistory.length === 0) return;
		// 信号判断优先用今日实时估值（与卡片/状态栏口径一致）；未更新时回退昨日净值
		const estNav = todayEstimateNav(this.plugin.store.snapshot.estimates, fund.code);
		const latestNav = estNav?.nav ?? fund.navHistory[fund.navHistory.length - 1]!.netWorth;
		const { holdingCost, cumulativeCost } = this.costInfo(fund);
		if (holdingCost <= 0) {
			el.createSpan({
				text: '暂无持仓成本，无法计算买卖信号（需先有买入记录）。',
				cls: 'inv-chart-signal-text muted',
			});
			return;
		}
		const sig = computeTrendChannelSignal(
			fund.navHistory,
			{ holdingCost, cumulativeCost },
			this.getConfig(),
			estNav?.nav ?? null,
		);
		if (!sig) {
			el.createSpan({
				text: `今日暂无买卖信号（最新${estNav ? '估值' : '净值'} ${latestNav.toFixed(4)}）。`,
				cls: 'inv-chart-signal-text muted',
			});
			return;
		}
		if (sig.type === 'buy') {
			el.createSpan({ cls: 'inv-chart-signal-text buy' }).setText(
				`买入信号：最新${estNav ? '估值' : '净值'} ${sig.latestNav.toFixed(4)} 低于持仓成本 ${sig.holdingCost.toFixed(4)} 且低于通道下轨，可考虑分批买入。`,
			);
		} else {
			el.createSpan({ cls: 'inv-chart-signal-text sell' }).setText(
				`卖出信号：最新${estNav ? '估值' : '净值'} ${sig.latestNav.toFixed(4)} 高于持仓成本 ${sig.holdingCost.toFixed(4)} 且高于通道上轨，可考虑止盈/减仓。`,
			);
		}
	}

	private renderChannel(el: HTMLElement): void {
		disposeChart(this.chart);
		this.chart = null;
		el.empty();
		const fund = this.current;
		if (!fund || fund.navHistory.length === 0) {
			el.createEl('p', { text: '暂无净值数据', cls: 'inv-chart-empty' });
			return;
		}
		// 页签隐藏时容器尺寸为 0，跳过初始化，切回趋势通道页签时由 setTab 重建
		if (this.activeTab !== 'channel') return;
		// 把今日实时估值作为灰色末点并进通道图（估值未更新时回退为不追加）
		const estimatedNav = todayEstimateNav(this.plugin.store.snapshot.estimates, fund.code);
		const { holdingCost, cumulativeCost } = this.costInfo(fund);
		this.chart = initChart(
			el,
			buildChannelOption(
				fund.navHistory,
				this.getConfig(),
				fund.resolved,
				estimatedNav,
				holdingCost > 0 ? holdingCost : null,
				cumulativeCost,
			),
		);
		this.chart.resize();
	}

	// ---------- 持仓分析页签 ----------

	/**
	 * 渲染持仓分析：懒加载与三态、录入行、联动三图均由共享视图 `HoldingsValuationView` 实现。
	 * `force` 为重试/手动录入变更：跳过缓存重新请求。
	 */
	private renderHoldings(force = false): void {
		const fund = this.current;
		const pane = this.holdingsPaneEl;
		if (!fund || !pane) return;
		this.holdingsView.render(pane, fund.code, fund.filePath, fund.name, force);
	}

	private buildParamControls(): void {
		const params = this.paramsEl;
		if (!params) return;
		params.empty();
		if (!this.current) return;

		const fieldRow = (label: string): HTMLDivElement => {
			const row = params.createDiv({ cls: 'inv-chart-field' });
			row.createDiv({ cls: 'inv-chart-field-label', text: label });
			return row;
		};

		{
			const row = fieldRow('均线类型');
			const select = row.createEl('select', { cls: 'inv-chart-select' });
			CHANNEL_AVG_TYPE_OPTIONS.forEach((opt) => {
				select.createEl('option', { text: opt.label, value: opt.value });
			});
			select.value = this.getConfig().avgType;
			select.addEventListener('change', () =>
				this.applyConfig((cfg) => {
					cfg.avgType = select.value === 'ema' ? 'ema' : 'sma';
				}),
			);
		}

		{
			const row = fieldRow('均线天数');
			const line = row.createDiv({ cls: 'inv-chart-line' });
			const input = line.createEl('input', {
				cls: 'inv-chart-number-input',
				attr: { type: 'number', min: '1', max: '365' },
			});
			input.value = String(this.getConfig().avgDays);
			input.addEventListener('change', () =>
				this.applyConfig((cfg) => {
					cfg.avgDays = clampInt(input.value, 1, 365, DEFAULT_CHANNEL_CONFIG.avgDays);
				}),
			);
			const presets = line.createDiv({ cls: 'inv-chart-presets' });
			CHANNEL_AVG_PRESETS.forEach((d) => {
				const b = presets.createEl('button', {
					cls: 'inv-chart-preset',
					text: `${d}天`,
					attr: { type: 'button' },
				});
				b.addEventListener('click', () => {
					input.value = String(d);
					this.applyConfig((cfg) => {
						cfg.avgDays = d;
					});
				});
			});
		}

		{
			const row = fieldRow('标准差类型');
			const select = row.createEl('select', { cls: 'inv-chart-select' });
			CHANNEL_STD_TYPE_OPTIONS.forEach((opt) => {
				select.createEl('option', { text: opt.label, value: opt.value });
			});
			select.value = this.getConfig().stdType;
			select.addEventListener('change', () =>
				this.applyConfig((cfg) => {
					cfg.stdType = select.value === 'global' ? 'global' : 'rolling';
				}),
			);
			row.createDiv({
				cls: 'inv-chart-field-hint',
				text: '滚动标准差窗口与均线天数一致',
			});
		}
	}
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
	const v = Number(value);
	if (!Number.isFinite(v)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(v)));
}
