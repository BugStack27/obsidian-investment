import { Modal } from 'obsidian';
import type InvestmentPlugin from '../main';
import type { HoldingSummary, NetWorthRecord, ResolvedTransaction } from '../types';
import { calcCompareSeries, type CompareSeries } from '../utils/dcaCompareCalc';
import { CHART_COLORS } from './charts/theme';
import { disposeChart, initChart, type ChartInstance, type ChartOption } from './charts/echartsInit';

export interface DcaCompareModalProps {
	navHistory: NetWorthRecord[];
	resolved: ResolvedTransaction[];
	summary: HoldingSummary | null;
	code: string | null;
}

/**
 * 定投对比弹窗：上下两张图，共用同一时间段与分类 X 轴。
 * - 图1：实际年化 vs 定投年化（左轴%，XIRR 口径，末端与卡片一致）+ 净值（右轴）+ 买卖点。
 * - 图2：收益差 = 实际年化 − 定投年化（左轴%）+ 净值（右轴）+ 买卖点。
 * 定投不可算时整窗显示占位提示。
 */
export class DcaCompareModal extends Modal {
	private readonly props: DcaCompareModalProps;
	private chart: ChartInstance | null = null;
	private chart2: ChartInstance | null = null;

	constructor(plugin: InvestmentPlugin, props: DcaCompareModalProps) {
		super(plugin.app);
		this.props = props;
	}

	onOpen(): void {
		this.modalEl.addClass('inv-dca-modal');
		const { contentEl } = this;

		contentEl.createDiv({
			cls: 'inv-channel-header',
			text: '手动操作 vs 定投对比',
		});

		const chart1El = contentEl.createDiv({ cls: 'inv-chart-body inv-dca-chart' });
		const chart2El = contentEl.createDiv({ cls: 'inv-chart-body inv-dca-chart' });
		const series = calcCompareSeries(this.props.resolved, this.props.navHistory);
		this.renderCharts(chart1El, chart2El, series);

		// 弹窗动画后修正一次图表尺寸，避免初始化时宽度测量为 0
		window.setTimeout(() => {
			this.chart?.resize();
			this.chart2?.resize();
		}, 60);
	}

	onClose(): void {
		disposeChart(this.chart);
		this.chart = null;
		disposeChart(this.chart2);
		this.chart2 = null;
		this.contentEl.empty();
	}

	private renderCharts(
		el1: HTMLElement,
		el2: HTMLElement,
		series: CompareSeries | null,
	): void {
		disposeChart(this.chart);
		this.chart = null;
		disposeChart(this.chart2);
		this.chart2 = null;
		el1.empty();
		el2.empty();

		if (!series) {
			el1.createEl('p', {
				cls: 'inv-chart-empty',
				text: '暂无足够数据计算对比曲线（需至少两次买入或多个净值交易日）。',
			});
			return;
		}

		const hint = el1.createDiv({ cls: 'inv-chart-signal-text muted' });
		hint.setText(`定投策略：每交易日投入 ${series.perDay.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元 · 年化收益按持有满 30 天后开始计算`);

		const wrap1 = el1.createDiv({ cls: 'inv-dca-chart-body' });
		this.chart = initChart(wrap1, this.buildChart1Option(series));
		this.chart.resize();

		const wrap2 = el2.createDiv({ cls: 'inv-dca-chart-body' });
		this.chart2 = initChart(wrap2, this.buildChart2Option(series));
		this.chart2.resize();
	}

	/** 真实买卖映射到净值曲线的散点（买入红、卖出绿），供两图复用 */
	private buildTradePoints(series: CompareSeries): Array<Record<string, unknown>> {
		const pts: Array<Record<string, unknown>> = [];
		for (const tx of this.props.resolved) {
			if (tx.pending || (tx.type !== 'buy' && tx.type !== 'sell')) continue;
			const idx = series.dates.findIndex((d) => d >= tx.date);
			if (idx < 0) continue;
			const nav = series.navs[idx];
			if (nav == null) continue;
			pts.push({
				value: [idx, nav],
				symbol: 'circle',
				itemStyle: {
					color: tx.type === 'buy' ? CHART_COLORS.profit : CHART_COLORS.loss,
					borderColor: '#fff',
					borderWidth: 1,
				},
			});
		}
		return pts;
	}

	private yAxisTemplate(): Array<Record<string, unknown>> {
		return [
			{
				type: 'value',
				scale: true,
				splitLine: { lineStyle: { color: CHART_COLORS.borderLight, width: 1 } },
				axisLabel: {
					fontSize: 9,
					color: CHART_COLORS.textTertiary,
					formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
				},
				axisLine: { show: false },
				axisTick: { show: false },
			},
			{
				type: 'value',
				scale: true,
				splitLine: { show: false },
				axisLabel: { fontSize: 9, color: CHART_COLORS.secondary },
				axisLine: { show: false },
				axisTick: { show: false },
				name: '净值',
				nameTextStyle: { fontSize: 9, color: CHART_COLORS.secondary },
			},
		];
	}

	private xAxisTemplate(dates: string[]): Record<string, unknown> {
		return {
			type: 'category',
			data: dates,
			boundaryGap: false,
			axisLine: { show: false },
			axisTick: { show: false },
			axisLabel: { fontSize: 9, color: CHART_COLORS.textTertiary },
			splitLine: { show: false },
		};
	}

	private buildChart1Option(series: CompareSeries): ChartOption {
		const dates = series.dates;
		const manualPts: Array<Record<string, unknown> | null> = series.manualYields.map(v =>
			v == null ? null : { value: v },
		);
		const dcaPts: Array<Record<string, unknown> | null> = series.dcaYields.map(v =>
			v == null ? null : { value: v },
		);
		const navPts = series.navs.map((v) => ({ value: v }));
		const tradePts = this.buildTradePoints(series);

		const fmtPct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
		const mono = "font-family:'Geist Mono',monospace";
		const row = (label: string, value: string, color: string): string =>
			`<div style="display:flex;justify-content:space-between;gap:16px;">` +
			`<span style="color:${CHART_COLORS.textTertiary}">${label}</span>` +
			`<span style="color:${color};${mono}">${value}</span></div>`;

		return {
			legend: {
				data: ['实际年化', '定投年化', '净值'],
				top: 0,
				left: 'center',
				itemWidth: 14,
				itemHeight: 8,
				textStyle: { fontSize: 10, color: CHART_COLORS.textSecondary },
			},
			grid: { left: 46, right: 46, top: 36, bottom: 24, containLabel: false },
			xAxis: this.xAxisTemplate(dates),
			yAxis: this.yAxisTemplate(),
			series: [
				{ type: 'line', name: '实际年化', yAxisIndex: 0, data: manualPts, showSymbol: false, connectNulls: false, lineStyle: { color: CHART_COLORS.primary, width: 2 }, z: 2 },
				{ type: 'line', name: '定投年化', yAxisIndex: 0, data: dcaPts, showSymbol: false, connectNulls: false, lineStyle: { color: CHART_COLORS.secondary, width: 2, type: 'dashed' }, z: 2 },
				{ type: 'line', name: '净值', yAxisIndex: 1, data: navPts, showSymbol: false, lineStyle: { color: CHART_COLORS.textSecondary, width: 1, opacity: 0.6 }, z: 1 },
				{ type: 'scatter', name: '交易点位', yAxisIndex: 1, data: tradePts, symbolSize: 8, z: 4, animation: false, tooltip: { show: false } },
			],
			dataZoom: [{ type: 'inside', start: 0, end: 100, minSpan: 5 }],
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'cross' },
				backgroundColor: CHART_COLORS.bgCard,
				borderColor: CHART_COLORS.borderLight,
				borderWidth: 1,
				textStyle: { fontSize: 11, color: CHART_COLORS.textPrimary },
				formatter: (params: unknown) => {
					const arr = params as Array<{ dataIndex?: number }>;
					const idx = arr?.[0]?.dataIndex ?? 0;
					const dateStr = dates[idx] ?? '';
					if (!dateStr) return '';
					const mVal = series.manualYields[idx] ?? null;
					const dVal = series.dcaYields[idx] ?? null;
					const nVal = series.navs[idx] ?? null;
					return `<div style="font-weight:600;margin-bottom:4px;${mono};color:${CHART_COLORS.textPrimary}">${dateStr}</div>` +
						(mVal != null ? row('实际年化', fmtPct(mVal), mVal >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss) : '') +
						(dVal != null ? row('定投年化', fmtPct(dVal), dVal >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss) : '') +
						(nVal != null ? row('净值', nVal.toFixed(4), CHART_COLORS.textSecondary) : '');
				},
				extraCssText: 'border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:8px 12px;',
			},
		};
	}

	private buildChart2Option(series: CompareSeries): ChartOption {
		const dates = series.dates;
		// 收益差 = 实际年化 − 定投年化（任一侧缺失则 null）
		const diffPts: Array<Record<string, unknown> | null> = series.manualYields.map((m, i) => {
			const d = series.dcaYields[i] ?? null;
			if (m == null || d == null) return null;
			return { value: m - d };
		});
		const navPts = series.navs.map((v) => ({ value: v }));
		const tradePts = this.buildTradePoints(series);

		const fmtPct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
		const mono = "font-family:'Geist Mono',monospace";
		const row = (label: string, value: string, color: string): string =>
			`<div style="display:flex;justify-content:space-between;gap:16px;">` +
			`<span style="color:${CHART_COLORS.textTertiary}">${label}</span>` +
			`<span style="color:${color};${mono}">${value}</span></div>`;

		return {
			legend: {
				data: ['收益差', '净值'],
				top: 0,
				left: 'center',
				itemWidth: 14,
				itemHeight: 8,
				textStyle: { fontSize: 10, color: CHART_COLORS.textSecondary },
			},
			grid: { left: 46, right: 46, top: 36, bottom: 24, containLabel: false },
			xAxis: this.xAxisTemplate(dates),
			yAxis: this.yAxisTemplate(),
			series: [
				{ type: 'line', name: '收益差', yAxisIndex: 0, data: diffPts, showSymbol: false, connectNulls: false, lineStyle: { color: CHART_COLORS.primary, width: 2 }, z: 2 },
				{ type: 'line', name: '净值', yAxisIndex: 1, data: navPts, showSymbol: false, lineStyle: { color: CHART_COLORS.textSecondary, width: 1, opacity: 0.6 }, z: 1 },
				{ type: 'scatter', name: '交易点位', yAxisIndex: 1, data: tradePts, symbolSize: 8, z: 4, animation: false, tooltip: { show: false } },
			],
			dataZoom: [{ type: 'inside', start: 0, end: 100, minSpan: 5 }],
			tooltip: {
				trigger: 'axis',
				axisPointer: { type: 'cross' },
				backgroundColor: CHART_COLORS.bgCard,
				borderColor: CHART_COLORS.borderLight,
				borderWidth: 1,
				textStyle: { fontSize: 11, color: CHART_COLORS.textPrimary },
				formatter: (params: unknown) => {
					const arr = params as Array<{ dataIndex?: number }>;
					const idx = arr?.[0]?.dataIndex ?? 0;
					const dateStr = dates[idx] ?? '';
					if (!dateStr) return '';
					const mVal = series.manualYields[idx] ?? null;
					const dVal = series.dcaYields[idx] ?? null;
					const nVal = series.navs[idx] ?? null;
					const diff = mVal != null && dVal != null ? mVal - dVal : null;
					return `<div style="font-weight:600;margin-bottom:4px;${mono};color:${CHART_COLORS.textPrimary}">${dateStr}</div>` +
						(diff != null ? row('收益差(实际-定投)', fmtPct(diff), diff >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss) : '') +
						(nVal != null ? row('净值', nVal.toFixed(4), CHART_COLORS.textSecondary) : '');
				},
				extraCssText: 'border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:8px 12px;',
			},
		};
	}
}