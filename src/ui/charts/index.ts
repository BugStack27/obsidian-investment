import { setIcon } from 'obsidian';
import type InvestmentPlugin from '../../main';
import type { ChartRangeKey } from '../../settings';
import type { HoldingSummary, NetWorthRecord, ResolvedTransaction } from '../../types';
import { calcDailyProfits } from '../../utils/profitChartCalc';
import { ChannelModal } from '../channelModal';
import { buildNavOption } from './navChart';
import { buildProfitOption } from './profitChart';
import { disposeChart, initChart, type ChartInstance } from './echartsInit';

type RangeKey = ChartRangeKey;

const RANGES: { key: RangeKey; label: string }[] = [
	{ key: '6m', label: '近6月' },
	{ key: '1y', label: '近1年' },
	{ key: '3y', label: '近3年' },
	{ key: 'all', label: '全部' },
];

const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = {
	'6m': 180,
	'1y': 365,
	'3y': 1095,
};

function toDateStr(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function filterByRange(navHistory: NetWorthRecord[], key: RangeKey): NetWorthRecord[] {
	if (key === 'all' || navHistory.length === 0) return navHistory;
	const days = RANGE_DAYS[key];
	const last = new Date(navHistory[navHistory.length - 1]!.date + 'T00:00:00');
	const cutoff = new Date(last.getTime() - (days - 1) * 86_400_000);
	const cutoffStr = toDateStr(cutoff);
	return navHistory.filter((r) => r.date >= cutoffStr);
}

/** 图表卡片与指标分析入口所需的当前基金上下文 */
export interface ChartsProps {
	navHistory: NetWorthRecord[];
	resolved: ResolvedTransaction[];
	summary: HoldingSummary | null;
	code: string | null;
}

/**
 * 在交易记录表格上方渲染"净值走势"、"收益走势"两张卡片；
 * 顶部"指标分析"图标打开通道分析弹窗（默认选中当前笔记对应的基金）。
 */
export function renderCharts(plugin: InvestmentPlugin, el: HTMLElement, props: ChartsProps): void {
	const wrap = el.createDiv({ cls: 'inv-chart-cards' });

	// ---------- 净值走势卡 ----------
	const navCard = wrap.createDiv({ cls: 'inv-chart-card' });
	const navHead = navCard.createDiv({ cls: 'inv-chart-head' });
	const navHeadLeft = navHead.createDiv({ cls: 'inv-chart-head-left' });
	navHeadLeft.createSpan({ text: '净值走势', cls: 'inv-chart-title' });

	const analysisBtn = navHeadLeft.createEl('button', {
		cls: 'inv-chart-icon-btn',
		attr: { type: 'button', title: '指标分析', 'aria-label': '指标分析' },
	});
	setIcon(analysisBtn, 'activity');

	const tabsEl = navHead.createDiv({ cls: 'inv-chart-tabs' });
	const navBody = navCard.createDiv({ cls: 'inv-chart-body' });

	// ---------- 收益走势卡 ----------
	const profitCard = wrap.createDiv({ cls: 'inv-chart-card' });
	const profitHead = profitCard.createDiv({ cls: 'inv-chart-head' });
	profitHead.createSpan({ text: '收益走势', cls: 'inv-chart-title' });
	const profitBody = profitCard.createDiv({ cls: 'inv-chart-body' });

	let navChart: ChartInstance | null = null;
	let profitChart: ChartInstance | null = null;
	let currentRange: RangeKey = plugin.settings.chartRange;

	const renderEmpty = (body: HTMLElement): void => {
		body.empty();
		body.createEl('p', { text: '暂无净值数据', cls: 'inv-chart-empty' });
	};

	const render = (range: RangeKey): void => {
		currentRange = range;
		const filtered = filterByRange(props.navHistory, range);

		disposeChart(navChart);
		navChart = null;
		if (filtered.length === 0) {
			renderEmpty(navBody);
		} else {
			navBody.empty();
			navChart = initChart(navBody, buildNavOption(filtered, props.resolved, props.summary));
		}

		const daily = calcDailyProfits(filtered, props.resolved);
		disposeChart(profitChart);
		profitChart = null;
		if (!daily) {
			renderEmpty(profitBody);
		} else {
			profitBody.empty();
			profitChart = initChart(
				profitBody,
				buildProfitOption(daily.profits, daily.xLabels, daily.holdingProfits, daily.endLabel),
			);
		}
	};

	analysisBtn.addEventListener('click', () => {
		new ChannelModal(plugin, { initialCode: props.code }).open();
	});

	// ---------- 区间 tabs ----------
	RANGES.forEach((r) => {
		const tab = tabsEl.createEl('button', {
			cls: 'inv-chart-tab' + (r.key === currentRange ? ' active' : ''),
			text: r.label,
			attr: { type: 'button' },
		});
		tab.addEventListener('click', () => {
			if (r.key === currentRange) return;
			tabsEl.querySelectorAll('.inv-chart-tab').forEach((t) => t.classList.remove('active'));
			tab.classList.add('active');
			plugin.settings.chartRange = r.key;
			void plugin.saveSettings();
			render(r.key);
		});
	});

	render(currentRange);
}