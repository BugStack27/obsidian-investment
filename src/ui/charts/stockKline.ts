import { CHART_COLORS } from './theme';
import type { ChartOption } from './echartsInit';
import type { StockKlinePoint } from '../../services/stockSdk';
import type { Transaction } from '../../types';

/**
 * K 线图：蜡烛图 + 买入/卖出标记点。
 * A 股配色：阳线红、阴线绿；买入红点、卖出绿点（与移动端一致）。
 * 交易标记映射到包含交易日期的 K 线（取首个 date>=交易日期 的 K 线，用其收盘价定位）。
 */
export function buildStockKlineOption(
	points: StockKlinePoint[],
	transactions: Transaction[],
): ChartOption {
	const dates = points.map((p) => p.date);
	const candleData = points.map((p) => [p.open, p.close, p.low, p.high]);

	const buys: [string, number][] = [];
	const sells: [string, number][] = [];
	for (const tx of transactions) {
		if (tx.shares <= 0 || (tx.type !== 'buy' && tx.type !== 'sell')) continue;
		const target = points.find((p) => p.date >= tx.date);
		if (!target) continue;
		if (tx.type === 'buy') buys.push([target.date, target.close]);
		else sells.push([target.date, target.close]);
	}

	const total = points.length;
	const zoomDays = 60;
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
				const arr = params as Array<{ axisValue?: string; seriesName?: string; value?: unknown }>;
				if (!arr || arr.length === 0) return '';
				const date = arr[0]?.axisValue || '';
				const mono = "font-family:'Geist Mono',monospace";
				let html = `<div style="font-weight:600;margin-bottom:4px;font-size:11px;${mono}">${date}</div>`;
				for (const p of arr) {
					const raw = p.value;
					if (raw === null || raw === undefined) continue;
					const arr2 = raw as unknown[];
					const num = (v: unknown): string =>
						Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—';
					const row = (label: string, val: string, color?: string): void => {
						html += `<div style="display:flex;justify-content:space-between;gap:24px;font-size:11px;line-height:1.6"><span style="color:${CHART_COLORS.textTertiary}">${label}</span><span style="color:${color ?? CHART_COLORS.textPrimary};${mono};font-weight:500">${val}</span></div>`;
					};
					if (arr2.length >= 4 && typeof arr2[0] === 'number') {
						row('开', num(arr2[0]));
						row('收', num(arr2[1]));
						row('低', num(arr2[2]));
						row('高', num(arr2[3]));
					} else if (arr2.length === 2) {
						row(p.seriesName ?? '', num(arr2[1]));
					}
				}
				return html;
			},
		},
		legend: {
			data: ['买入', '卖出'].filter((name, i) =>
				i === 0 ? buys.length > 0 : sells.length > 0,
			),
			textStyle: { color: CHART_COLORS.textSecondary, fontSize: 10 },
			bottom: 0,
			icon: 'circle',
			itemWidth: 8,
			itemHeight: 8,
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
			scale: true,
			splitLine: { lineStyle: { color: CHART_COLORS.borderLight, type: 'dashed' } },
			axisLabel: { color: CHART_COLORS.textTertiary, fontSize: 9 },
		},
		series: [
			{
				name: 'K线',
				type: 'candlestick',
				data: candleData,
				itemStyle: {
					color: CHART_COLORS.profit,
					color0: CHART_COLORS.loss,
					borderColor: CHART_COLORS.profit,
					borderColor0: CHART_COLORS.loss,
				},
				z: 10,
			},
			{
				name: '买入',
				type: 'scatter',
				data: buys,
				symbol: 'circle',
				symbolSize: 10,
				itemStyle: { color: CHART_COLORS.profit, borderColor: '#fff', borderWidth: 1 },
				z: 20,
			},
			{
				name: '卖出',
				type: 'scatter',
				data: sells,
				symbol: 'circle',
				symbolSize: 10,
				itemStyle: { color: CHART_COLORS.loss, borderColor: '#fff', borderWidth: 1 },
				z: 20,
			},
		],
		dataZoom: [
			{ type: 'inside', start: startPct, end: 100, minValueSpan: 5 },
			{ type: 'slider', start: startPct, end: 100, height: 14, bottom: 18 },
		],
	};

	return option as unknown as ChartOption;
}
