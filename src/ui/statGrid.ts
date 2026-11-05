import type { RealtimeEstimate } from '../services/realtimeEstimate';
import { todayKey } from '../services/signalAlerts';
import { todayProfitDateLabel } from '../services/portfolioOverview';
import type { HoldingSummary } from '../types';
import type { DcaAnnualResult } from '../utils/dcaCalc';
import { fmtMoney, fmtPercent, fmtShares, fmtSignedMoney, profitColor } from '../utils/format';
import type { LastYearProfitResult } from '../utils/profitChartCalc';

export interface StatItem {
	label: string;
	value: string;
	color?: string;
	/** 主数值下方的小字备注，单独一行显示 */
	sub?: string;
	/** 小字备注的着色（若不填则以 .inv-stat-sub 弱化色显示） */
	subColor?: string;
	/** 点击该卡片时触发的回调（可选，用于如"定投年化"弹出对比图） */
	onClick?: () => void;
}

export interface LastOperation {
	buy: { change: number; days: number } | null;
	sell: { change: number; days: number } | null;
}

export function summaryStats(
	s: HoldingSummary,
	estimate?: RealtimeEstimate | null,
	lastYear?: LastYearProfitResult | null,
	lastOp?: LastOperation | null,
	/** 年化收益率（小数，由数据中枢统一下发，避免重复计算） */
	annual: number = 0,
	/** 定投年化（无脑定投策略，由调用方计算后传入） */
	dca?: DcaAnnualResult | null,
	/** 点击"定投年化"卡片时的回调（用于弹出对比弹窗） */
	onDcaCardClick?: () => void,
): StatItem[] {
	// 最新净值与盘中估值合并为一个卡片：仅当日估值视为有效盘中估值，否则显示最新净值（周末/非交易时段回退）
	// 净值拉取失败时不能按 0 净值展示，否则收益类指标会算出 −100%
	const navOk = s.navAvailable;
	const validEstimate = navOk && estimate && estimate.date === todayKey() ? estimate : null;
	const nav: StatItem = validEstimate
		? {
				label: '盘中估值',
				value: `${validEstimate.gsz.toFixed(4)} ${fmtPercent(validEstimate.gszzl / 100, 2, true)}`,
				sub: validEstimate.gztime,
				color: profitColor(validEstimate.gszzl),
			}
		: navOk
			? { label: '最新净值', value: `${s.latestNav.toFixed(4)}`, sub: s.navDate }
			: { label: '最新净值', value: '—', sub: '净值获取失败' };

	// 最近一年收益卡片：主行为收益金额，卡片内下方为最近一年的收益率。
	// 一年前基准投入为 0 时（如持仓不足一年），回退用当前累计投入作分母，与 invest-app 口径一致。
	const lastYearRate = lastYear
		? lastYear.rate != null
			? lastYear.rate
			: s.totalInvested > 0
				? lastYear.amount / s.totalInvested
				: null
		: null;
	const lastYearItem: StatItem = lastYear
		? {
				label: '最近一年收益',
				value: fmtSignedMoney(lastYear.amount),
				color: profitColor(lastYear.amount),
				sub: lastYearRate != null ? `收益率 ${fmtPercent(lastYearRate, 2, true)}` : undefined,
				subColor: profitColor(lastYear.amount),
			}
		: { label: '最近一年收益', value: '—' };

	// 年化收益率由数据中枢统一计算后传入（见 summaryStats 第 5 参），此处不再计算

	// 上次买入 / 上次卖出：主行显示自操作日至今的涨跌幅（考虑当日估值），下方小字为距今天数
	const fmtLastOpDays = (op: { change: number; days: number } | null): string =>
		op ? (op.days === 0 ? '今日' : `${op.days}天前`) : '';
	const lastBuyItem: StatItem = lastOp?.buy
		? {
				label: '上次买入',
				value: fmtPercent(lastOp.buy.change, 2, true),
				color: profitColor(lastOp.buy.change),
				sub: fmtLastOpDays(lastOp.buy),
			}
		: { label: '上次买入', value: '—' };
	const lastSellItem: StatItem = lastOp?.sell
		? {
				label: '上次卖出',
				value: fmtPercent(lastOp.sell.change, 2, true),
				color: profitColor(lastOp.sell.change),
				sub: fmtLastOpDays(lastOp.sell),
			}
		: { label: '上次卖出', value: '—' };

	const items: StatItem[] = [
		nav,
		{
			label: '持仓成本',
			value: `${fmtMoney(s.avgCostPerShare, 4)}/份`,
			sub: `份额：${fmtShares(s.holdShares)}`,
		},
		{
			label: '持仓收益',
			value: navOk ? fmtSignedMoney(s.holdingProfit) : '—',
			color: navOk ? profitColor(s.holdingProfit) : undefined,
			sub: `收益率：${navOk ? fmtPercent(s.holdingProfitRate, 2, true) : '—'}`,
			subColor: navOk ? profitColor(s.holdingProfit) : undefined,
		},
		{
			label: '总收益',
			value: navOk ? fmtMoney(s.totalProfit) : '—',
			color: navOk ? profitColor(s.totalProfit) : undefined,
			sub: `收益率：${navOk ? fmtPercent(s.totalProfitRate, 2, true) : '—'}`,
			subColor: navOk ? profitColor(s.totalProfit) : undefined,
		},
		lastYearItem,
		lastBuyItem,
		lastSellItem,
		...(s.totalDividend > 0
			? [{ label: '累计分红', value: fmtMoney(s.totalDividend) }]
			: []),
		{
			label: '持仓市值',
			value: navOk ? fmtMoney(s.holdAmount) : '—',
			// 副标题恒为已结算净值口径（不随盘中估值变化），故标签跟随最新净值日，避免非交易日误标「今日」
			sub: navOk ? `${todayProfitDateLabel(s.navDate)}：${fmtMoney(s.todayProfit)}` : undefined,
			subColor: navOk ? profitColor(s.todayProfit) : undefined,
		},
		{
			label: '持有天数',
			value: `${s.holdDays} 天`,
			sub: `年化：${navOk ? fmtPercent(annual, 2, true) : '—'}`,
			subColor: navOk ? profitColor(annual) : undefined,
		},
		dca
			? {
					label: '定投年化',
					value: fmtPercent(dca.annualRate, 2, true),
					color: profitColor(dca.annualRate),
					sub: `${fmtMoney(dca.perDayAmount)}/天 · ${dca.tradingDays}天`,
					onClick: onDcaCardClick,
				}
			: { label: '定投年化', value: '—', onClick: onDcaCardClick },
	];
	return items;
}

export function renderStatGrid(el: HTMLElement, stats: StatItem[]): void {
	const wrap = el.createDiv({ cls: 'inv-summary' });
	for (const it of stats) {
		const cell = wrap.createDiv({ cls: 'inv-stat' });
		const v = cell.createDiv({ text: it.value, cls: 'inv-stat-value' });
		if (it.sub) {
			const sub = cell.createDiv({ text: it.sub, cls: 'inv-stat-sub' });
			if (it.subColor) sub.style.color = it.subColor;
		}
		cell.createDiv({ text: it.label, cls: 'inv-stat-label' });
		if (it.color) v.style.color = it.color;
		if (it.onClick) {
			cell.addClass('inv-stat-clickable');
			cell.addEventListener('click', it.onClick);
		}
	}
}