import { CHART_COLORS } from './theme';
import type { ChartOption } from './echartsInit';
import type { NetWorthRecord, ResolvedTransaction } from '../../types';
import { calcTrendChannel } from '../../utils/indicatorCalc';

/** 买卖标记点：x 轴日期 + 净值 + 对应交易金额（不含手续费） */
interface TxMarker {
	date: string;
	nav: number;
	amount: number;
	type: 'buy' | 'sell';
}

/** 趋势通道配置（与移动端对齐，按基金持久化）；滚动标准差窗口与均线天数一致，故不再单设标准差天数 */
export interface TrendChannelConfigValues {
	avgType: 'sma' | 'ema';
	avgDays: number;
	stdType: 'rolling' | 'global';
}

export const DEFAULT_CHANNEL_CONFIG: TrendChannelConfigValues = {
	avgType: 'sma',
	avgDays: 20,
	stdType: 'rolling',
};

function hexToRgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const CHANNEL_COLOR = hexToRgba(CHART_COLORS.secondary, 0.18);
const CHANNEL_COLOR_LIGHT = hexToRgba(CHART_COLORS.secondary, 0.05);
/** 持仓成本参考线颜色：琥珀金，区别于买红/卖绿/均线蓝 */
const COST_LINE_COLOR = '#D97706';

/** 当日实时估值（用于把最新估值作为最后一个灰色点追加到通道末） */
export interface EstimatedPoint {
	date: string;
	nav: number;
}

/**
 * 趋势通道图：净值线 + 均线 + 标准差通道填充 + 上/下轨虚线 + 买卖标记 + 持仓成本参考线。
 * 复刻移动端 indicatorRegistry.ts 的趋势通道实现。
 * 传 `estimated` 时，将最新当日估值作为灰色虚线末点追加（复刻 IndicatorAnalysisDialog）。
 * 传 `holdingCost`（>0 的加权平均成本口径）时，绘制一条水平虚线持仓成本参考线。
 * 传 `cumulativeCost`（>0 的累计投入/持有份额口径）且**严格高于** `holdingCost` 时，
 * 额外绘制一条同色系点线累计成本参考线；不满足条件时不绘制，持仓成本线行为不变。
 */
export function buildChannelOption(
	netWorths: NetWorthRecord[],
	config: TrendChannelConfigValues,
	transactions: ResolvedTransaction[],
	estimated?: EstimatedPoint | null,
	holdingCost?: number | null,
	cumulativeCost?: number | null,
): ChartOption {
	const result = calcTrendChannel(
		netWorths.map((r) => ({ date: r.date, nav: r.netWorth })),
		{
			avg: { type: config.avgType, period: config.avgDays },
			std: { type: config.stdType, period: config.avgDays },
		},
	);

	const { points } = result;
	const dates = points.map((p) => p.date);
	const avgLabel = config.avgType === 'sma' ? `SMA(${config.avgDays})` : `EMA(${config.avgDays})`;
	const isEmpty = (v: number | null | undefined): boolean => v === null || v === undefined;

	const upperData = points.map((p) => p.upper);
	const lowerData = points.map((p) => p.lower);

	// 通道填充：底层(下轨) + 差值堆叠面积，实现上下轨间精确填充
	const lowerBase = lowerData.map((v) => (isEmpty(v) ? undefined : v));
	const diffFill = upperData.map((v, i) => {
		if (v === null || lowerData[i] === null) return undefined;
		return v - lowerData[i]!;
	});
	const upperClean = upperData.map((v) => (isEmpty(v) ? undefined : v));

	// 成本参考线（markLine 多行数据）：持仓成本线常显；累计成本线仅在严格高于持仓成本时叠加。
	// 颜色同色系（琥珀金）区分于买红/卖绿/均线蓝，两线靠线型与标签位置区分：持仓成本=虚线/上，累计成本=点线/下。
	const hasHoldingCost =
		typeof holdingCost === 'number' && Number.isFinite(holdingCost) && holdingCost > 0;
	const hasCumulativeCost =
		hasHoldingCost &&
		typeof cumulativeCost === 'number' &&
		Number.isFinite(cumulativeCost) &&
		cumulativeCost > 0 &&
		cumulativeCost > holdingCost;
	const costMarkLineData: Array<Record<string, unknown>> = [];
	if (hasHoldingCost) {
		costMarkLineData.push({
			yAxis: holdingCost,
			lineStyle: { color: COST_LINE_COLOR, width: 1, type: 'dashed' },
			label: {
				position: 'insideEndTop',
				color: COST_LINE_COLOR,
				fontSize: 10,
				formatter: '持仓成本 {c}',
			},
		});
	}
	if (hasCumulativeCost) {
		costMarkLineData.push({
			yAxis: cumulativeCost,
			lineStyle: { color: COST_LINE_COLOR, width: 1, type: 'dotted' },
			label: {
				position: 'insideEndBottom',
				color: COST_LINE_COLOR,
				fontSize: 10,
				formatter: `累计成本 ${cumulativeCost.toFixed(4)}`,
			},
		});
	}

	const series: Array<Record<string, unknown>> = [
		{
			id: 'nav',
			name: '净值',
			type: 'line',
			data: points.map((p) => p.nav),
			smooth: false,
			symbol: 'none',
			lineStyle: { color: CHART_COLORS.navLine, width: 2 },
			// 成本参考线：持仓成本常显，累计成本仅在高于持仓成本时追加（详见上方 hasCumulativeCost）
			markLine:
				costMarkLineData.length > 0
					? { symbol: 'none', silent: true, animation: false, data: costMarkLineData }
					: undefined,
			z: 10,
		},
		{
			id: 'avg-line',
			name: avgLabel,
			type: 'line',
			data: points.map((p) => (isEmpty(p.avg) ? undefined : p.avg)),
			smooth: false,
			symbol: 'none',
			lineStyle: { color: CHART_COLORS.secondary, width: 2 },
			connectNulls: false,
			z: 10,
		},
		{
			id: 'channel-base',
			name: '通道底',
			type: 'line',
			data: lowerBase,
			smooth: false,
			symbol: 'none',
			lineStyle: { opacity: 0 },
			stack: 'channel',
			z: 1,
		},
		{
			id: 'channel-fill',
			name: '通道填充',
			type: 'line',
			data: diffFill,
			smooth: false,
			symbol: 'none',
			lineStyle: { opacity: 0 },
			stack: 'channel',
			areaStyle: {
				color: {
					type: 'linear',
					x: 0,
					y: 0,
					x2: 0,
					y2: 1,
					colorStops: [
						{ offset: 0, color: CHANNEL_COLOR },
						{ offset: 1, color: CHANNEL_COLOR_LIGHT },
					],
				},
			},
			z: 0,
		},
		{
			id: 'upper-band',
			name: '上通道',
			type: 'line',
			data: upperClean,
			smooth: false,
			symbol: 'none',
			lineStyle: { color: CHART_COLORS.textTertiary, width: 1, type: 'dashed' },
			connectNulls: false,
			z: 2,
		},
		{
			id: 'lower-band',
			name: '下通道',
			type: 'line',
			data: lowerData.map((v) => (isEmpty(v) ? undefined : v)),
			smooth: false,
			symbol: 'none',
			lineStyle: { color: CHART_COLORS.textTertiary, width: 1, type: 'dashed' },
			connectNulls: false,
			z: 2,
		},
	];

	// 买卖标记点：只有出现在净值日上的交易才标记；同日多笔合并为一条，金额累加
	const navByDate = new Map(points.map((p) => [p.date, p.nav]));
	const mergeMarkers = (type: 'buy' | 'sell'): TxMarker[] => {
		const byDate = new Map<string, TxMarker>();
		for (const tx of transactions) {
			if (tx.pending || tx.type !== type) continue;
			const nav = navByDate.get(tx.date);
			if (nav === undefined) continue;
			const hit = byDate.get(tx.date);
			if (hit) hit.amount += tx.amount;
			else byDate.set(tx.date, { date: tx.date, nav, amount: tx.amount, type });
		}
		return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
	};
	const buys = mergeMarkers('buy');
	const sells = mergeMarkers('sell');
	const pushScatter = (items: TxMarker[], type: 'buy' | 'sell', name: string, color: string): void => {
		if (items.length === 0) return;
		series.push({
			id: `tx-${type}`,
			name,
			type: 'scatter',
			data: items.map((m) => ({
				value: [m.date, m.nav],
				_date: m.date,
				_nav: m.nav,
				_amount: m.amount,
				_type: m.type,
			})),
			symbol: 'circle',
			// 尺寸取小、无白描边：买卖密集时避免标记点遮挡曲线，且保持纯色实心可辨识
			symbolSize: 5,
			itemStyle: { color },
			z: 20,
		});
	};
	// 命名「买入」「卖出」，使 tooltip 能识别并展示交易金额
	pushScatter(buys, 'buy', '买入', CHART_COLORS.profit);
	pushScatter(sells, 'sell', '卖出', CHART_COLORS.loss);

	// 默认聚焦最近 30 个交易日
	const total = points.length;
	const zoomDays = 30;
	const startPct = total > zoomDays ? ((total - zoomDays) / total) * 100 : 0;

	const option = {
		backgroundColor: 'transparent',
		animation: true,
		animationDuration: 500,
		animationEasing: 'cubicOut',
		tooltip: {
			trigger: 'axis',
			confine: true,
			backgroundColor: CHART_COLORS.bgCard,
			borderColor: CHART_COLORS.borderLight,
			borderWidth: 1,
			textStyle: { color: CHART_COLORS.textPrimary, fontSize: 11 },
			formatter: (params: unknown) => {
				const arr = params as Array<{
					axisValue?: string;
					seriesName?: string;
					value?: unknown;
					data?: Record<string, unknown>;
				}>;
				if (!arr || arr.length === 0) return '';
				const date = arr[0]?.axisValue || '';
				const mono = "font-family:'Geist Mono',monospace";
				let html = `<div style="font-weight:600;margin-bottom:4px;font-size:11px;${mono}">${date}</div>`;
				// 买卖点为独立系列：均值/通道等线型系列在该轴无值会返回 null/NaN，先过滤掉
				const rows: string[] = [];
				const tradeRows: Array<{ type: string; amount: number; nav: number }> = [];
				for (const p of arr) {
					const raw = p.value;
					if (Array.isArray(raw)) {
						// 散点（买卖点）数据项：识别 _type 取出类型/金额/点位净值；
						// 其他数组型数据（如末点估值）无 _type，直接跳过
						const d: Record<string, unknown> | undefined = p.data;
						if (!d) continue;
						const type = d._type;
						if (type !== 'buy' && type !== 'sell') continue;
						// 日期比对：axis trigger 下散点仅在命中分类时返回，此处兜底防止跨分类误匹配
						if (d._date !== date) continue;
						const amount = Number(d._amount);
						const nav = Number(d._nav);
						if (!Number.isFinite(amount) || amount <= 0) continue;
						if (!Number.isFinite(nav)) continue;
						tradeRows.push({ type, amount, nav });
						continue;
					}
					const val = Number(raw);
					if (raw === null || raw === undefined || !Number.isFinite(val)) continue;
					rows.push(
						`<div style="display:flex;justify-content:space-between;gap:24px;font-size:11px;line-height:1.6"><span style="color:${CHART_COLORS.textTertiary}">${p.seriesName ?? ''}</span><span style="color:${CHART_COLORS.textPrimary};${mono};font-weight:500">${val.toFixed(4)}</span></div>`,
					);
				}
				html += rows.join('');
				for (const t of tradeRows) {
					const isBuy = t.type === 'buy';
					const color = isBuy ? CHART_COLORS.profit : CHART_COLORS.loss;
					const label = isBuy ? '买入金额' : '卖出金额';
					const sign = isBuy ? '-' : '+';
					const tip = isBuy ? '买入点位净值' : '卖出点位净值';
					html += `<div style="display:flex;justify-content:space-between;gap:24px;font-size:11px;line-height:1.6"><span style="color:${color};font-weight:500">${label}</span><span style="color:${color};${mono};font-weight:600">${sign}¥${t.amount.toFixed(2)}</span></div>`;
					html += `<div style="display:flex;justify-content:space-between;gap:24px;font-size:10px;line-height:1.5;margin-bottom:2px"><span style="color:${CHART_COLORS.textTertiary}">${tip}</span><span style="color:${CHART_COLORS.textSecondary};${mono}">${t.nav.toFixed(4)}</span></div>`;
				}
				return html;
			},
		},
		legend: {
			data: ['净值', avgLabel, '上通道', '下通道'],
			textStyle: { color: CHART_COLORS.textSecondary, fontSize: 10 },
			bottom: 0,
			icon: 'roundRect',
			itemWidth: 14,
			itemHeight: 3,
		},
		grid: { left: 50, right: 16, top: 8, bottom: 36 },
		xAxis: {
			type: 'category',
			data: dates,
			axisLine: { lineStyle: { color: CHART_COLORS.borderLight } },
			axisLabel: {
				color: CHART_COLORS.textTertiary,
				fontSize: 9,
				formatter: (v: string) => {
					const parts = v.split('-');
					return parts.length === 3 ? `${parts[1]}-${parts[2]}` : v;
				},
			},
			splitLine: { show: false },
		},
		yAxis: {
			type: 'value',
			// 不从 0 起，贴合可见数据范围；dataZoom 缩放窗口时也随可见数据自适应
			scale: true,
			splitLine: { lineStyle: { color: CHART_COLORS.borderLight, type: 'dashed' } },
			axisLabel: { color: CHART_COLORS.textTertiary, fontSize: 9 },
		},
		series,
		dataZoom: [
			{ type: 'inside', start: startPct, end: 100, minValueSpan: 10 },
			{ type: 'slider', start: startPct, end: 100, height: 14, bottom: 18 },
		],
	};

	appendEstimatedPoint(option, netWorths, estimated);

	return option as unknown as ChartOption;
}

/**
 * 把最新当日估值追加为通道末的灰色虚线末点（复刻原项目 IndicatorAnalysisDialog）：
 * 仅在估值日期晚于最后一笔净值日期时追加；x 轴末尾补一个分类，所有折线 series 尾部补 null，
 * 再用 `nav-estimated` 系列从最后一个真实净值连到估值灰点。
 */
function appendEstimatedPoint(
	option: { xAxis: { data: string[] }; series: Array<Record<string, unknown>> },
	netWorths: NetWorthRecord[],
	estimated?: EstimatedPoint | null,
): void {
	if (!estimated || estimated.nav == null) return;
	const lastDate = netWorths.length > 0 ? netWorths[netWorths.length - 1]!.date : '';
	if (estimated.date <= lastDate) return;

	option.xAxis.data.push(estimated.date);

	let lastNavValue: number | null = null;
	for (const s of option.series) {
		if (s.type !== 'line') continue;
		const data = s.data as unknown[] | undefined;
		if (!data) continue;
		if (s.id === 'nav') {
			const last = data[data.length - 1];
			if (typeof last === 'number') lastNavValue = last;
		}
		data.push(null);
	}

	if (lastNavValue == null) return;
	const extData = new Array<number | null>(netWorths.length > 0 ? netWorths.length - 1 : 0).fill(null);
	extData.push(lastNavValue, estimated.nav);
	option.series.push({
		id: 'nav-estimated',
		name: '净值(预估)',
		type: 'line',
		data: extData,
		smooth: false,
		symbol: 'circle',
		symbolSize: 5,
		lineStyle: { color: '#aaa', width: 2, type: 'dashed' },
		itemStyle: { color: '#aaa' },
		connectNulls: false,
		z: 10,
	});
}

export const CHANNEL_AVG_TYPE_OPTIONS = [
	{ label: 'SMA（简单移动平均）', value: 'sma' },
	{ label: 'EMA（指数移动平均）', value: 'ema' },
];
export const CHANNEL_STD_TYPE_OPTIONS = [
	{ label: '滚动标准差', value: 'rolling' },
	{ label: '全局标准差', value: 'global' },
];
export const CHANNEL_AVG_PRESETS = [7, 20, 30];