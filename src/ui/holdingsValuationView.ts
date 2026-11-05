import { Notice } from 'obsidian';
import type InvestmentPlugin from '../main';
import { disposeChart, echarts, initChart, type ChartInstance } from './charts/echartsInit';
import {
	buildHoldingsPeOption,
	buildHoldingsPbOption,
	buildHoldingsPepbOption,
	sortHoldingsByValue,
} from './charts/holdingsValuation';
import {
	computeSafetyScore,
	fetchValuationSnapshotsAt,
	loadFundHoldingsAnalysis,
	type FundHoldingsAnalysis,
	type SafetyMetricScore,
} from '../services/fundHoldings';
import { readHoldingRows, writeHoldingRows } from '../utils/holdingBlock';
import { FundHoldingEditModal } from './fundHoldingEditModal';

/**
 * 持仓估值视图：顶部控制行（手动补充 + 对比分析）+ 安全度分析卡 + PE/PB/PE×PB 三张柱状图
 * （横轴缩放 + echarts connect 联动）。
 * 指标分析弹窗（ChannelModal）与买卖信号弹窗（SignalModal）复用；
 * 手动持仓持久化在基金笔记的 ```fund-holding``` 块（编码/名称/比例/当前持仓 CSV），录入经编辑弹窗完成。
 */
export class HoldingsValuationView {
	private static instanceSeq = 0;
	/** 每个视图实例独立 connect 分组：同时打开的多个弹窗是不同基金，禁止跨弹窗误联动 */
	private readonly groupId = `inv-holdings-valuation-${++HoldingsValuationView.instanceSeq}`;

	private readonly plugin: InvestmentPlugin;
	private peChart: ChartInstance | null = null;
	private pbChart: ChartInstance | null = null;
	private pepbChart: ChartInstance | null = null;
	/** 按基金缓存（null = 已加载且无股票持仓），随 dispose 释放；只存不含对比值的基础数据 */
	private cache = new Map<string, FundHoldingsAnalysis | null>();
	/** 加载令牌：重复触发/切换基金时丢弃过期异步结果 */
	private token = 0;
	/** 对比分析选定的日期（YYYY-MM-DD）；null = 不对比。跨基金保持 */
	private compareDate: string | null = null;

	constructor(plugin: InvestmentPlugin) {
		this.plugin = plugin;
	}

	dispose(): void {
		disposeChart(this.peChart);
		this.peChart = null;
		disposeChart(this.pbChart);
		this.pbChart = null;
		disposeChart(this.pepbChart);
		this.pepbChart = null;
		this.cache.clear();
	}

	/**
	 * 渲染到 pane：命中缓存直接画图，否则懒加载（加载中占位 → 成功/失败重试/无持仓三态）。
	 * `filePath` 为基金笔记路径（读写 fund-holding 块用）；`fundName` 用于编辑弹窗标题；
	 * `force` 为重试/保存后强制重拉。pane 须已可见（隐藏容器内 echarts 初始化尺寸为 0）。
	 */
	render(
		pane: HTMLElement,
		fundCode: string,
		filePath: string,
		fundName: string,
		force = false,
	): void {
		if (!pane) return;
		disposeChart(this.peChart);
		this.peChart = null;
		disposeChart(this.pbChart);
		this.pbChart = null;
		disposeChart(this.pepbChart);
		this.pepbChart = null;

		pane.empty();
		pane.createDiv({ cls: 'inv-channel-holdings-hint', text: '加载中…' });
		pane.createEl('p', { text: '拉取重仓股行情…', cls: 'inv-chart-empty' });

		const token = ++this.token;
		void (async (): Promise<FundHoldingsAnalysis | null> => {
			// 基础数据（缓存只存无对比值的干净数据，对比值每次现算后仅用于绘制）
			let base: FundHoldingsAnalysis | null;
			const cached = this.cache.get(fundCode);
			if (!force && cached !== undefined) {
				base = cached;
			} else {
				const rows = await readHoldingRows(this.plugin.app, filePath);
				base = await loadFundHoldingsAnalysis(fundCode, rows);
				this.cache.set(fundCode, base);
			}
			if (!base || !this.compareDate) return base;
			// 对比分析：批量拉「当时」估值快照，合并为副本（不污染缓存）
			const snapshots = await fetchValuationSnapshotsAt(
				base.items.map((it) => it.code),
				this.compareDate,
			);
			const byCode = new Map(snapshots.map((s) => [s.code, s]));
			return {
				...base,
				items: base.items.map((it) => {
					const s = byCode.get(it.code);
					return {
						...it,
						peThen: s?.peTtm ?? null,
						pbThen: s?.pbMrq ?? null,
						marketCapThen: s?.totalMarketCap ?? null,
					};
				}),
			};
		})()
			.then((data) => {
				// 令牌过期（已切换/重复触发）或弹窗已关闭时丢弃结果
				if (token !== this.token || !pane.isConnected) return;
				this.paint(pane, fundCode, filePath, fundName, data);
			})
			.catch(() => {
				if (token !== this.token || !pane.isConnected) return;
				pane.empty();
				pane.createEl('p', { text: '获取持仓行情失败，请稍后重试。', cls: 'inv-chart-empty' });
				const retry = pane.createEl('button', {
					cls: 'inv-chart-preset',
					text: '重试',
					attr: { type: 'button' },
				});
				retry.addEventListener('click', () =>
					this.render(pane, fundCode, filePath, fundName, true),
				);
			});
	}

	/** 用已加载的数据画 PE/PB/PE×PB 三张柱状图 */
	private paint(
		pane: HTMLElement,
		fundCode: string,
		filePath: string,
		fundName: string,
		data: FundHoldingsAnalysis | null,
	): void {
		pane.empty();
		// 顶部控制行：手动补充 + 对比分析合并为一行
		this.buildControlRow(pane, fundCode, filePath, fundName);

		if (!data) {
			pane.createEl('p', {
				text: '该基金暂无自动持仓数据，可点击上方「编辑持仓」手动录入后查看估值。',
				cls: 'inv-chart-empty',
			});
			return;
		}
		// 安全度分析：阈值占比加权评分（谨慎 / 激进两档）
		this.buildSafetyCard(pane, data);
		const peWrap = pane.createDiv({ cls: 'inv-holdings-chart' });
		const pbWrap = pane.createDiv({ cls: 'inv-holdings-chart' });
		const pepbWrap = pane.createDiv({ cls: 'inv-holdings-chart' });
		// 三图共用同一顺序（PE 降序），联动缩放时同位置是同一只股票
		const items = sortHoldingsByValue(data.items, 'pe');
		const compareDate = this.compareDate ?? undefined;
		this.peChart = initChart(peWrap, buildHoldingsPeOption(items, compareDate));
		this.pbChart = initChart(pbWrap, buildHoldingsPbOption(items, compareDate));
		this.pepbChart = initChart(pepbWrap, buildHoldingsPepbOption(items, compareDate));
		// echarts connect：三图联动横轴缩放/平移与 tooltip
		for (const c of [this.peChart, this.pbChart, this.pepbChart]) {
			c.group = this.groupId;
		}
		echarts.connect(this.groupId);
		this.peChart.resize();
		this.pbChart.resize();
		this.pepbChart.resize();
	}

	/**
	 * 顶部控制行：手动补充入口 + 对比分析日期，合并在同一行（窄宽度自动换行）。
	 * 对比态下改为「当前 vs 日期」+ 清除按钮。
	 */
	private buildControlRow(
		pane: HTMLElement,
		fundCode: string,
		filePath: string,
		fundName: string,
	): void {
		const row = pane.createDiv({ cls: 'inv-holdings-control' });

		row.createSpan({ cls: 'inv-holdings-manual-label', text: '手动补充' });
		row
			.createEl('button', {
				cls: 'inv-chart-preset',
				text: '编辑持仓…',
				attr: { type: 'button' },
			})
			.addEventListener('click', () =>
				this.openHoldingEditor(pane, fundCode, filePath, fundName),
			);

		row.createDiv({ cls: 'inv-holdings-control-sep' });

		row.createSpan({ cls: 'inv-holdings-manual-label', text: '对比分析' });
		if (this.compareDate) {
			row.createSpan({
				cls: 'inv-holdings-compare-active',
				text: `当前 vs ${this.compareDate}`,
			});
			row
				.createEl('button', { cls: 'inv-chart-preset', text: '清除', attr: { type: 'button' } })
				.addEventListener('click', () => {
					this.compareDate = null;
					this.render(pane, fundCode, filePath, fundName);
				});
			return;
		}

		const now = new Date();
		const pad = (n: number): string => String(n).padStart(2, '0');
		const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
		const dateInput = row.createEl('input', {
			cls: 'inv-holdings-compare-date',
			attr: { type: 'date', max: today },
		});
		row
			.createEl('button', { cls: 'inv-chart-preset', text: '对比', attr: { type: 'button' } })
			.addEventListener('click', () => {
				const date = dateInput.value;
				if (!date) {
					new Notice('请先选择对比日期');
					return;
				}
				if (date > today) {
					new Notice('对比日期不能晚于今天');
					return;
				}
				this.compareDate = date;
				this.render(pane, fundCode, filePath, fundName);
			});
	}

	/** 手动补充入口：打开编辑弹窗（搜索添加 + 表格编辑），保存写回笔记 fund-holding 块 */
	private openHoldingEditor(
		pane: HTMLElement,
		fundCode: string,
		filePath: string,
		fundName: string,
	): void {
		void (async () => {
			const rows = await readHoldingRows(this.plugin.app, filePath);
			new FundHoldingEditModal(this.plugin.app, {
				fundCode,
				fundName,
				rows,
				onSave: (next) => {
					void writeHoldingRows(this.plugin.app, filePath, next)
						.then(() => this.render(pane, fundCode, filePath, fundName, true))
						.catch((e) =>
							new Notice(`保存失败：${e instanceof Error ? e.message : String(e)}`),
						);
				},
			}).open();
		})().catch((e) =>
			new Notice(`读取持仓失败：${e instanceof Error ? e.message : String(e)}`),
		);
	}

	// ---------- 安全度分析 ----------

	/** 安全度卡：标题行（对比态带日期标识）+ 谨慎/激进总分块 + PE/PB/PE×PB 三个子项 */
	private buildSafetyCard(pane: HTMLElement, data: FundHoldingsAnalysis): void {
		const cur = computeSafetyScore(data.items, 'current');
		const then = this.compareDate ? computeSafetyScore(data.items, 'then') : null;

		const wrap = pane.createDiv({ cls: 'inv-holdings-safety' });
		const head = wrap.createDiv({ cls: 'inv-holdings-safety-head' });
		head.createSpan({ cls: 'inv-holdings-safety-title', text: '安全度分析' });
		if (this.compareDate) {
			head.createSpan({
				cls: 'inv-holdings-safety-scope',
				text: `${this.compareDate} → 当前`,
			});
		}

		const grid = wrap.createDiv({ cls: 'inv-holdings-safety-grid' });
		const totalCard = grid.createDiv({ cls: 'inv-holdings-safety-card is-total' });
		this.renderSafetyTier(
			totalCard,
			'谨慎',
			cur.conservative.score,
			then?.conservative.score ?? null,
		);
		this.renderSafetyTier(
			totalCard,
			'激进',
			cur.aggressive.score,
			then?.aggressive.score ?? null,
		);

		this.renderSafetyMetric(
			grid,
			'PE（TTM）',
			'50%',
			cur.conservative.pe,
			then?.conservative.pe ?? null,
			cur.aggressive.pe,
			then?.aggressive.pe ?? null,
		);
		this.renderSafetyMetric(
			grid,
			'PB（MRQ）',
			'30%',
			cur.conservative.pb,
			then?.conservative.pb ?? null,
			cur.aggressive.pb,
			then?.aggressive.pb ?? null,
		);
		this.renderSafetyMetric(
			grid,
			'PE×PB',
			'20%',
			cur.conservative.pepb,
			then?.conservative.pepb ?? null,
			cur.aggressive.pepb,
			then?.aggressive.pepb ?? null,
		);
	}

	/** 总分块里的一档：分数 + 等级标签 + 进度条 */
	private renderSafetyTier(
		card: HTMLElement,
		label: string,
		cur: number | null,
		then: number | null,
	): void {
		const box = card.createDiv({ cls: 'inv-holdings-safety-tier' });
		box.createDiv({ cls: 'inv-holdings-safety-tier-label', text: label });
		const line = box.createDiv({ cls: 'inv-holdings-safety-tier-value' });
		if (cur != null && then != null) {
			line.createSpan({ cls: 'inv-holdings-safety-was', text: `${Math.round(then)} →` });
		}
		const level = safetyLevel(cur);
		line.createSpan({
			cls: `inv-holdings-safety-score ${levelClass(level)}`,
			text: cur == null ? '—' : String(Math.round(cur)),
		});
		if (level !== 'none') {
			line.createSpan({
				cls: `inv-holdings-safety-pill ${levelClass(level)}`,
				text: SAFETY_LABEL[level],
			});
		}
		const fill = box
			.createDiv({ cls: 'inv-holdings-safety-bar' })
			.createDiv({ cls: `inv-holdings-safety-fill ${levelClass(level)}` });
		fill.style.width = `${clampPct(cur)}%`;
	}

	/** 子项卡：标题 + 谨慎/激进两行占比 + 覆盖度脚注（不足 100% 才显示） */
	private renderSafetyMetric(
		grid: HTMLElement,
		label: string,
		weight: string,
		curCons: SafetyMetricScore,
		thenCons: SafetyMetricScore | null,
		curAggr: SafetyMetricScore,
		thenAggr: SafetyMetricScore | null,
	): void {
		const card = grid.createDiv({ cls: 'inv-holdings-safety-card' });
		const head = card.createDiv({ cls: 'inv-holdings-safety-card-head' });
		head.createSpan({ text: label });
		head.createSpan({ cls: 'inv-holdings-safety-weight', text: weight });
		this.renderSafetyMetricRow(card, '谨慎', curCons, thenCons);
		this.renderSafetyMetricRow(card, '激进', curAggr, thenAggr);

		// 覆盖度：该指标有效市值占全部持仓市值；不足 100% 说明评分分母不完整
		const cov = curCons.coverage;
		if (cov != null && cov < 99.95) {
			card.createDiv({
				cls: 'inv-holdings-safety-coverage',
				text: `覆盖 ${Math.round(cov)}% 市值`,
			});
		}
	}

	/** 子项里的一档：当时→当前占比 + 只数 + 进度条 */
	private renderSafetyMetricRow(
		card: HTMLElement,
		label: string,
		cur: SafetyMetricScore,
		then: SafetyMetricScore | null,
	): void {
		const ratio = cur.stat.ratio;
		const level = safetyLevel(ratio);
		const row = card.createDiv({ cls: 'inv-holdings-safety-row' });
		row.createSpan({ cls: 'inv-holdings-safety-row-label', text: label });
		const value = row.createSpan({ cls: 'inv-holdings-safety-row-value' });
		if (ratio != null && then?.stat.ratio != null) {
			value.createSpan({
				cls: 'inv-holdings-safety-was',
				text: `${Math.round(then.stat.ratio)}→`,
			});
		}
		value.createSpan({
			cls: `inv-holdings-safety-pct ${levelClass(level)}`,
			text: ratio == null ? '—' : `${Math.round(ratio)}%`,
		});
		row.createSpan({
			cls: 'inv-holdings-safety-count',
			text: `${cur.stat.belowCount}/${cur.stat.totalCount}`,
		});

		const fill = card
			.createDiv({ cls: 'inv-holdings-safety-bar' })
			.createDiv({ cls: `inv-holdings-safety-fill ${levelClass(level)}` });
		fill.style.width = `${clampPct(ratio)}%`;
	}
}

/** 安全度档位：≥75 安全、≥50 中性、≥25 偏险、其余危险；null 为无数据 */
type SafetyLevel = 'safe' | 'neutral' | 'risky' | 'danger' | 'none';

const SAFETY_LABEL: Record<Exclude<SafetyLevel, 'none'>, string> = {
	safe: '安全',
	neutral: '中性',
	risky: '偏险',
	danger: '危险',
};

function safetyLevel(score: number | null): SafetyLevel {
	if (score == null) return 'none';
	if (score >= 75) return 'safe';
	if (score >= 50) return 'neutral';
	if (score >= 25) return 'risky';
	return 'danger';
}

/** 档位 → CSS 类名（颜色定义在 styles.css，浅色主题另有覆盖） */
function levelClass(level: SafetyLevel): string {
	return level === 'none' ? '' : `inv-level-${level}`;
}

/** 进度条宽度：夹到 0–100，无数据按 0 画 */
function clampPct(v: number | null): number {
	if (v == null || !Number.isFinite(v)) return 0;
	return Math.max(0, Math.min(100, v));
}
