import type { NetWorthRecord, ResolvedTransaction } from '../types';
import { xirr, type CashFlow } from './xirr';

/** 定投对比弹窗用的逐日数据系列 */
export interface CompareSeries {
	/** 交易日日期（定投区间内，升序） */
	dates: string[];
	/** 实际年化收益率（小数；持有<minHeldDays 天或期末无持仓时为 null） */
	manualYields: (number | null)[];
	/** 定投年化收益率（小数；持有不足 minHeldDays 天时为 null） */
	dcaYields: (number | null)[];
	/** 净值序列 */
	navs: number[];
	/** 每交易日定投额 */
	perDay: number;
}

/** 持有至少多少天才计算年化收益率，避免短期收益被年化放大（约 1 个月） */
const MIN_HELD_DAYS = 30;

/** 相对首次买入日的持有天数（最小为 1，避免首日天数为 0） */
function heldDays(firstBuyDate: string, date: string): number {
	const diff =
		(new Date(date + 'T00:00:00Z').getTime() - new Date(firstBuyDate + 'T00:00:00Z').getTime()) /
		86_400_000;
	return Math.max(1, Math.floor(diff));
}

/** 累计收益率 → 年化收益率的简单年化（仅用作 XIRR 不收敛时的保底填充） */
function simpleAnnualize(cumYield: number, days: number): number {
	return Math.pow(1 + cumYield, 365 / Math.max(1, days)) - 1;
}

/**
 * 构建"手动操作 vs 定投"逐日对比系列的共享数据。
 * 时间区间 = 定投区间（首次买入日 → 最新净值日），交易日取净值日。
 * 收益率曲线为"年化收益率"，采用 XIRR 资金加权（与被比对的统计卡片口径一致），
 * 末端的定投年化/实际年化分别与卡片「定投年化」「持有天数」年化完全一致。
 * 无净值 / 无买入 / 交易日不足 2 个时返回 null。
 */
export function calcCompareSeries(
	resolved: ResolvedTransaction[],
	navHistory: NetWorthRecord[],
): CompareSeries | null {
	// 首次买入日 & 总买入金额（排除 pending，忽略卖出/分红）
	const buys = resolved.filter(t => !t.pending && t.type === 'buy');
	if (buys.length === 0 || navHistory.length === 0) return null;
	let firstBuyDate = buys[0]!.date;
	let totalBuySum = 0;
	for (const b of buys) {
		if (b.date < firstBuyDate) firstBuyDate = b.date;
		totalBuySum += b.amount;
	}

	const latestDate = navHistory[navHistory.length - 1]!.date;
	const days = navHistory.filter(r => r.date >= firstBuyDate && r.date <= latestDate);
	if (days.length < 2) return null;

	const perDay = totalBuySum / days.length;

	// 逐日定投累计份额
	const dcaShares: number[] = [];
	let accShares = 0;
	for (const d of days) {
		if (d.netWorth > 0) accShares += perDay / d.netWorth;
		dcaShares.push(accShares);
	}

	// 实际：沿交易日推进买入/卖出/分红，维护现金流（买入-、卖出/分红+），并跟踪累计份额
	const txns = resolved
		.filter(t => !t.pending && (t.type === 'buy' || t.type === 'sell' || t.type === 'dividend'))
		.sort((a, b) => a.date.localeCompare(b.date));
	let txnIdx = 0;
	let cumShares = 0;
	let cumInvested = 0;
	const manualFlows: CashFlow[] = [];
	const dcaFlows: CashFlow[] = [];

	const dates: string[] = [];
	const manualYields: (number | null)[] = [];
	const dcaYields: (number | null)[] = [];
	const navs: number[] = [];

	for (let i = 0; i < days.length; i++) {
		const day = days[i]!;
		while (txnIdx < txns.length && txns[txnIdx]!.date <= day.date) {
			const t = txns[txnIdx]!;
			if (t.type === 'buy') {
				cumShares += t.shares;
				cumInvested += t.amount;
				manualFlows.push({ date: t.date, amount: -t.amount });
			} else if (t.type === 'sell') {
				cumShares -= t.shares;
				cumInvested -= t.amount;
				manualFlows.push({ date: t.date, amount: t.amount });
			} else {
				manualFlows.push({ date: t.date, amount: t.amount });
			}
			txnIdx++;
		}
		const nav = day.netWorth;
		dates.push(day.date);
		navs.push(nav);
		const daysHeld = heldDays(firstBuyDate, day.date);
		const before30 = daysHeld < MIN_HELD_DAYS;

		// 定投年化：日定投现金流(-perDay) + 期末市值，XIRR；XIRR 不收敛时回退简单年化填充
		if (nav > 0) dcaFlows.push({ date: day.date, amount: -perDay });
		const dcaValue = dcaShares[i]! * nav;
		const dcaInvested = perDay * (i + 1);
		let dcaY: number | null = null;
		if (!before30 && dcaValue > 0) {
			const irr = xirr([...dcaFlows, { date: day.date, amount: dcaValue }]);
			dcaY = irr != null
				? irr
				: dcaInvested > 0 ? simpleAnnualize(dcaValue / dcaInvested - 1, daysHeld) : null;
		}
		dcaYields.push(dcaY);

		// 实际年化：真实现金流 + 期末持仓市值，XIRR；XIRR 不收敛时回退简单年化填充
		let manualY: number | null = null;
		if (!before30 && cumShares > 0 && nav > 0) {
			const mValue = cumShares * nav;
			const irr = xirr([...manualFlows, { date: day.date, amount: mValue }]);
			manualY = irr != null
				? irr
				: cumInvested > 0 ? simpleAnnualize(cumShares * nav / cumInvested - 1, daysHeld) : null;
		}
		manualYields.push(manualY);
	}

	return { dates, manualYields, dcaYields, navs, perDay };
}