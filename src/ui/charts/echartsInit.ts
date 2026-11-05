import * as echarts from 'echarts/core';
import { LineChart, ScatterChart, CandlestickChart, BarChart } from 'echarts/charts';
import {
	GridComponent,
	TooltipComponent,
	DataZoomComponent,
	MarkLineComponent,
	MarkPointComponent,
	LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsType } from 'echarts/core';

// 按需注册，避免打包全量 echarts，与移动端 echartUtils.ts 一致
echarts.use([
	LineChart,
	ScatterChart,
	CandlestickChart,
	BarChart,
	GridComponent,
	TooltipComponent,
	DataZoomComponent,
	MarkLineComponent,
	MarkPointComponent,
	LegendComponent,
	CanvasRenderer,
]);

export { echarts };

export type ChartInstance = EChartsType;
export type ChartOption = Parameters<EChartsType['setOption']>[0];

const activeCharts = new Set<ChartInstance>();

export function initChart(el: HTMLElement, option: ChartOption): ChartInstance {
	const chart = echarts.init(el);
	chart.setOption(option);
	activeCharts.add(chart);
	return chart;
}

export function disposeChart(chart: ChartInstance | null): void {
	if (!chart) return;
	activeCharts.delete(chart);
	chart.dispose();
}

/** 记录块每次重新渲染前调用，避免残留的 echarts 实例泄漏 */
export function disposeAllCharts(): void {
	for (const chart of activeCharts) {
		try {
			chart.dispose();
		} catch {
			// 已销毁的实例忽略
		}
	}
	activeCharts.clear();
}