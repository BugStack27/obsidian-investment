import { CHART_COLORS } from './theme';
import type { ChartOption } from './echartsInit';
import type { HoldingValuationItem } from '../../services/fundHoldings';

/** 占位标记颜色：与坐标文字同级灰色，表示「有持仓但无数据」 */
const MISSING_COLOR = CHART_COLORS.textTertiary;

interface HoldingsMarkLine {
	/** 参考线数值 */
	value: number;
	/** 线色（低=绿、高=红由调用方指定） */
	color: string;
	/** 标签文案，如 "PE 15" */
	text: string;
}

/** 对比系列（历史估值）：系列名一般为所选日期 */
interface HoldingsCompareSpec {
	name: string;
	valueOf: (it: HoldingValuationItem) => number | null;
}

interface HoldingsOptionSpec {
	/** 指标显示名（series 名 / tooltip / 缺失提示） */
	label: string;
	/** 当前值函数，返回 null 表示无数据（画占位标记） */
	valueOf: (it: HoldingValuationItem) => number | null;
	/** 系列 id */
	seriesId: string;
	/** 水平参考线（可选，如 PE 的 15/30） */
	markLines?: HoldingsMarkLine[];
	/** 历史对比系列（可选）；传入后画「当前 vs 当时」分组柱状图 */
	compare?: HoldingsCompareSpec;
}

/** 对比系列柱色：琥珀金，与当前值的主蓝区分 */
const COMPARE_BAR_COLOR = '#D97706';

/**
 * 按指标值降序排列（null 排最后）。
 * PE/PB/PE×PB 三张图必须共用同一顺序，联动缩放时同一横轴位置才是同一只股票。
 */
export function sortHoldingsByValue(
	items: HoldingValuationItem[],
	key: 'pe' | 'pb',
): HoldingValuationItem[] {
	return [...items].sort((a, b) => {
		const va = a[key];
		const vb = b[key];
		if (va == null && vb == null) return 0;
		if (va == null) return 1;
		if (vb == null) return -1;
		return vb - va;
	});
}

/**
 * 重仓股估值柱状图（PE/PB/PE×PB 同构）：
 * 单 bar 系列（或「当前 vs 当时」分组双系列）+ 可选水平参考线（低=绿虚线、高=红虚线）；
 * 横轴支持滚轮缩放/拖动平移 + 底部滑块：把极端值"调出"可见窗口后，纵轴按可见柱子自动重算刻度。
 * 柱子顺序即入参顺序（联动缩放要求各图同序，由调用方用 sortHoldingsByValue 统一排序）。
 * 取不到值的分类不画柱，改在轴底画灰色空心圆占位标记，tooltip 提示无数据。
 */
function buildHoldingsOption(items: HoldingValuationItem[], spec: HoldingsOptionSpec): ChartOption {
	const { label, valueOf, seriesId, compare } = spec;
	// 占位标记：当前与对比两个系列都无值时才标记
	const missing = items.filter((it) => valueOf(it) == null && (!compare || compare.valueOf(it) == null));
	// tooltip 按分类名查条目：不依赖 axis trigger 对 null 数据的行为
	const itemByName = new Map(items.map((it) => [it.name, it]));

	const markLineData: Array<Record<string, unknown>> = (spec.markLines ?? []).map((m) => ({
		yAxis: m.value,
		lineStyle: { color: m.color, width: 1, type: 'dashed' },
		label: {
			position: 'insideEndTop',
			color: m.color,
			fontSize: 10,
			formatter: m.text,
		},
	}));

	const bar = (
		id: string,
		name: string,
		data: Array<number | null>,
		color: string,
		withMarkLine: boolean,
	): Record<string, unknown> => ({
		id,
		name,
		type: 'bar',
		data,
		barMaxWidth: 28,
		itemStyle: { color, borderRadius: [2, 2, 0, 0] },
		markLine:
			withMarkLine && markLineData.length > 0
				? { symbol: 'none', silent: true, animation: false, data: markLineData }
				: undefined,
		z: 10,
	});

	const series: Array<Record<string, unknown>> = [
		bar(
			seriesId,
			compare ? '当前' : label,
			items.map((it) => valueOf(it)),
			CHART_COLORS.secondary,
			true,
		),
	];
	if (compare) {
		series.push(
			bar(
				`${seriesId}-then`,
				compare.name,
				items.map((it) => compare.valueOf(it)),
				COMPARE_BAR_COLOR,
				false,
			),
		);
	}
	if (missing.length > 0) {
		series.push({
			id: `${seriesId}-missing`,
			name: '无数据',
			type: 'scatter',
			data: missing.map((it) => [it.name, 0]),
			symbol: 'circle',
			symbolSize: 6,
			itemStyle: { color: 'transparent', borderColor: MISSING_COLOR, borderWidth: 1.5 },
			silent: true,
			z: 5,
		});
	}

	const option = {
		backgroundColor: 'transparent',
		animation: true,
		animationDuration: 500,
		tooltip: {
			trigger: 'axis',
			confine: true,
			backgroundColor: CHART_COLORS.bgCard,
			borderColor: CHART_COLORS.borderLight,
			borderWidth: 1,
			textStyle: { color: CHART_COLORS.textPrimary, fontSize: 11 },
			formatter: (params: unknown) => {
				const arr = (params ?? []) as Array<{ axisValue?: string; name?: string }>;
				const name = arr[0]?.axisValue ?? arr[0]?.name ?? '';
				const head = `<div style="font-weight:600;margin-bottom:2px;font-size:11px">${name}</div>`;
				const it = itemByName.get(name);
				if (!it) {
					return `${head}<div style="font-size:11px;color:${CHART_COLORS.textTertiary}">无${label}数据</div>`;
				}
				const row = (k: string, val: string): string =>
					`<div style="display:flex;justify-content:space-between;gap:24px;font-size:11px"><span style="color:${CHART_COLORS.textTertiary}">${k}</span><span style="color:${CHART_COLORS.textPrimary};font-weight:500">${val}</span></div>`;
				const rows: string[] = [];
				const cur = valueOf(it);
				if (cur != null) rows.push(row(compare ? '当前' : label, cur.toFixed(2)));
				if (compare) {
					const then = compare.valueOf(it);
					rows.push(
						then != null
							? row(compare.name, then.toFixed(2))
							: `<div style="font-size:11px;color:${CHART_COLORS.textTertiary}">无${compare.name}数据</div>`,
					);
				}
				if (rows.length === 0) {
					return `${head}<div style="font-size:11px;color:${CHART_COLORS.textTertiary}">无${label}数据</div>`;
				}
				// 手动补充的比例（fund-holding 块）有值时一并展示
				const ratioRow = it.ratio != null ? row('持仓比例', `${it.ratio}%`) : '';
				return `${head}${rows.join('')}${ratioRow}`;
			},
		},
		// 对比模式下需要图例区分「当前 / 当时」
		...(compare
			? {
					legend: {
						data: ['当前', compare.name],
						textStyle: { color: CHART_COLORS.textSecondary, fontSize: 10 },
						top: 0,
						icon: 'roundRect',
						itemWidth: 14,
						itemHeight: 3,
					},
				}
			: {}),
		grid: compare
			? { left: 44, right: 16, top: 32, bottom: 74 }
			: { left: 44, right: 16, top: 20, bottom: 74 },
		xAxis: {
			type: 'category',
			data: items.map((it) => it.name),
			axisLine: { lineStyle: { color: CHART_COLORS.borderLight } },
			axisLabel: { color: CHART_COLORS.textTertiary, fontSize: 9, rotate: 35, interval: 0 },
			splitLine: { show: false },
		},
		yAxis: {
			// 柱状图诚实基线：从 0 起；缩放窗口时刻度由 echarts 自适应；不画横向网格虚线，保持图面干净
			type: 'value',
			min: 0,
			splitLine: { show: false },
			axisLabel: { color: CHART_COLORS.textTertiary, fontSize: 9 },
		},
		series,
		// 横轴缩放：滚轮缩放 + 拖动平移 + 底部滑块；filter 模式下窗外分类被移除，纵轴按可见柱子自动重算
		dataZoom: [
			{ type: 'inside', xAxisIndex: 0, minValueSpan: 3 },
			{ type: 'slider', xAxisIndex: 0, height: 14, bottom: 16, minValueSpan: 3 },
		],
	};

	return option;
}

/** 重仓股 PE(TTM) 柱状图，参考线 15 / 30；`compareDate` 传入时追加「当时」分组柱 */
export function buildHoldingsPeOption(items: HoldingValuationItem[], compareDate?: string): ChartOption {
	return buildHoldingsOption(items, {
		label: 'PE（TTM）',
		valueOf: (it) => it.pe,
		seriesId: 'holdings-pe',
		markLines: [
			{ value: 15, color: CHART_COLORS.loss, text: 'PE 15' },
			{ value: 30, color: CHART_COLORS.profit, text: 'PE 30' },
		],
		...(compareDate
			? { compare: { name: compareDate, valueOf: (it) => it.peThen ?? null } }
			: {}),
	});
}

/** 重仓股 PB 柱状图，参考线 1.5 / 3；`compareDate` 传入时追加「当时」分组柱 */
export function buildHoldingsPbOption(items: HoldingValuationItem[], compareDate?: string): ChartOption {
	return buildHoldingsOption(items, {
		label: 'PB（TTM）',
		valueOf: (it) => it.pb,
		seriesId: 'holdings-pb',
		markLines: [
			{ value: 1.5, color: CHART_COLORS.loss, text: 'PB 1.5' },
			{ value: 3, color: CHART_COLORS.profit, text: 'PB 3' },
		],
		...(compareDate
			? { compare: { name: compareDate, valueOf: (it) => it.pbThen ?? null } }
			: {}),
	});
}

/** 重仓股 PE×PB 柱状图：两者乘积，任一为 null 即无数据；参考线 22.5 / 45；对比柱为「当时」PE×PB */
export function buildHoldingsPepbOption(items: HoldingValuationItem[], compareDate?: string): ChartOption {
	return buildHoldingsOption(items, {
		label: 'PE×PB',
		valueOf: (it) => (it.pe != null && it.pb != null ? it.pe * it.pb : null),
		seriesId: 'holdings-pepb',
		markLines: [
			{ value: 22.5, color: CHART_COLORS.loss, text: 'PE×PB 22.5' },
			{ value: 45, color: CHART_COLORS.profit, text: 'PE×PB 45' },
		],
		...(compareDate
			? {
					compare: {
						name: compareDate,
						valueOf: (it) =>
							it.peThen != null && it.pbThen != null ? it.peThen * it.pbThen : null,
					},
				}
			: {}),
	});
}
