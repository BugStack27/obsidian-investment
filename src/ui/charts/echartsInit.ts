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
const resizeObservers = new WeakMap<ChartInstance, ResizeObserver>();

function resizeChart(chart: ChartInstance, el: HTMLElement): void {
	if (!activeCharts.has(chart)) return;
	const width = el.clientWidth;
	const height = el.clientHeight;
	if (width <= 0 || height <= 0) return;
	if (chart.getWidth() === width && chart.getHeight() === height) return;
	chart.resize();
}

/** 跟随容器宽高变化重排图表：笔记缩放、分栏拖动、窗口缩放都走这里 */
function observeResize(chart: ChartInstance, el: HTMLElement): void {
	const view = el.ownerDocument.defaultView ?? window;
	let frame = 0;
	const observer = new ResizeObserver(() => {
		if (frame) return;
		frame = view.requestAnimationFrame(() => {
			frame = 0;
			resizeChart(chart, el);
		});
	});
	observer.observe(el);
	resizeObservers.set(chart, observer);
}

export function initChart(el: HTMLElement, option: ChartOption): ChartInstance {
	// zrender 的默认 DPR 在模块加载时固定，Obsidian 缩放后新建图表仍会按旧 DPR 绘制；每次初始化现取
	const dpr = el.ownerDocument.defaultView?.devicePixelRatio ?? window.devicePixelRatio;
	const chart = echarts.init(el, undefined, { devicePixelRatio: dpr });
	chart.setOption(option);
	activeCharts.add(chart);
	observeResize(chart, el);
	return chart;
}

export function disposeChart(chart: ChartInstance | null): void {
	if (!chart) return;
	resizeObservers.get(chart)?.disconnect();
	resizeObservers.delete(chart);
	activeCharts.delete(chart);
	chart.dispose();
}

/** 记录块每次重新渲染前调用，避免残留的 echarts 实例泄漏 */
export function disposeAllCharts(): void {
	for (const chart of activeCharts) {
		resizeObservers.get(chart)?.disconnect();
		resizeObservers.delete(chart);
		try {
			chart.dispose();
		} catch {
			// 已销毁的实例忽略
		}
	}
	activeCharts.clear();
}
