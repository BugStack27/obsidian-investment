import { CHART_COLORS } from './theme';
import { echarts } from './echartsInit';
import type { ChartOption } from './echartsInit';

/**
 * 收益走势图：累计收益线 + 渐变面积 + 末端收益标注 + 可选持有收益虚线。
 * option 结构与移动端 ProfitChart.tsx 完全一致。
 */
export function buildProfitOption(
	profits: number[],
	xLabels: string[],
	holdingProfits: number[],
	endLabel: string,
): ChartOption {
	if (profits.length === 0) {
		return {};
	}

	const dates = xLabels.length > 0 ? xLabels : profits.map((_, i) => `${i}`);
	const profitData = profits.map((v, i) => ({ value: v, _date: dates[i] || '' }));

	const series: Array<Record<string, unknown>> = [
		{
			type: 'line',
			name: '累计收益',
			data: profitData,
			smooth: false,
			showSymbol: false,
			lineStyle: { color: CHART_COLORS.primary, width: 2 },
			areaStyle: {
				color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
					{ offset: 0, color: 'rgba(197, 61, 67, 0.12)' },
					{ offset: 1, color: 'rgba(197, 61, 67, 0)' },
				]),
			},
			markPoint: {
				symbol: 'roundRect',
				symbolSize: [50, 18],
				symbolOffset: [0, -14],
				data: [
					{
						coord: [dates.length - 1, profits[profits.length - 1]!],
						itemStyle: { color: CHART_COLORS.primary },
						label: {
							formatter: endLabel,
							color: '#fff',
							fontSize: 9,
							fontWeight: 600,
							position: 'inside',
						},
					},
				],
				z: 10,
			},
			z: 2,
		},
	];

	if (holdingProfits.length > 0) {
		series.push({
			type: 'line',
			name: '持仓收益',
			data: holdingProfits.map((v) => ({ value: v })),
			smooth: false,
			showSymbol: false,
			lineStyle: { color: CHART_COLORS.secondary, width: 2, type: 'dashed', opacity: 0.7 },
			z: 1,
		});
	}

	const option = {
		grid: { left: 40, right: 16, top: 16, bottom: 24 },
		xAxis: {
			type: 'category',
			data: dates,
			boundaryGap: false,
			axisLine: { show: false },
			axisTick: { show: false },
			axisLabel: { fontSize: 9, color: CHART_COLORS.textTertiary },
			splitLine: { show: false },
		},
		yAxis: {
			type: 'value',
			scale: true,
			splitLine: { lineStyle: { color: CHART_COLORS.borderLight, width: 1 } },
			axisLabel: {
				fontSize: 9,
				color: CHART_COLORS.textTertiary,
				formatter: (v: number) => {
					if (v === 0) return '0';
					const abs = Math.abs(v);
					if (abs >= 10000) return `${(v / 10000).toFixed(1)}万`;
					if (abs >= 1000) return `${(v / 1000).toFixed(1)}k`;
					return v.toFixed(0);
				},
			},
			axisLine: { show: false },
			axisTick: { show: false },
		},
		series,
		dataZoom: [{ type: 'inside', start: 0, end: 100, minSpan: 5 }],
		tooltip: {
			trigger: 'axis',
			axisPointer: { type: 'cross' },
			backgroundColor: CHART_COLORS.bgCard,
			borderColor: CHART_COLORS.borderLight,
			borderWidth: 1,
			textStyle: { fontSize: 11, color: CHART_COLORS.textPrimary },
			formatter: (params: unknown) => {
				const arr = params as Array<{ data?: Record<string, unknown> }>;
				if (!arr || arr.length === 0) return '';
				const main = arr[0]?.data;
				const holding = arr[1]?.data;
				if (!main || main._date === undefined) return '';
					const dateStr = main._date as string;
					const profit = main.value as number;
				const profitColor = profit >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
				const profitSign = profit >= 0 ? '+' : '';
				const mono = "font-family:'Geist Mono',monospace";
				let holdingHtml = '';
				if (holding && holding.value !== undefined) {
					const hProfit = holding.value as number;
					const hColor = hProfit >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
					const hSign = hProfit >= 0 ? '+' : '';
					holdingHtml = `<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.textTertiary}">持仓收益</span><span style="color:${hColor};${mono}">${hSign}¥${hProfit.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;
				}
				return `<div style="font-weight:600;margin-bottom:4px;${mono};color:${CHART_COLORS.textPrimary}">${dateStr}</div>
<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.textTertiary}">累计收益</span><span style="color:${profitColor};${mono}">${profitSign}¥${profit.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>${holdingHtml}`;
			},
			extraCssText:
				'border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:8px 12px;',
		},
	};

	return option;
}