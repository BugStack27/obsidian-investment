import type { HoldingSummary, NetWorthRecord, ResolvedTransaction, Transaction } from '../types';

/**
 * 用基金净值补全待确认交易。
 * - 买入 shares 缺失(0)：shares = amount / nav
 * - 买入 amount 缺失(0)：amount = shares × nav
 * - 卖出 amount 缺失(0)：amount = shares × nav
 * fee 默认 0；净值优先取记录日期当日，若当日无净值（非净值日）则顺延取随后的第一个净值日。
 * 买入/卖出在净值不可得时缺金额或缺份额，都标记 pending：宁可不出数，也不以 0 成本计入持仓。
 */
export function resolvePending(
	transactions: Transaction[],
	navByDate: Map<string, number>,
): ResolvedTransaction[] {
	const dates = [...navByDate.keys()].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
	return transactions.map((tx) => {
		const nav = findNav(tx.date, dates, navByDate);
		let { amount, shares } = tx;
		const fee = tx.fee || 0;
		if (nav != null) {
			if (tx.type === 'buy') {
				if (shares === 0 && amount > 0) shares = amount / nav;
				else if (amount === 0 && shares > 0) amount = shares * nav;
			} else if (tx.type === 'sell' && amount === 0 && shares > 0) {
				amount = shares * nav;
			}
		}
		const pending =
			tx.type === 'buy' ? amount === 0 || shares === 0 : amount === 0;
		const refNav = tx.type === 'dividend' ? null : nav;
		return { ...tx, amount, shares, fee, nav: refNav, pending };
	});
}

function findNav(date: string, dates: string[], navByDate: Map<string, number>): number | null {
	const exact = navByDate.get(date);
	if (exact != null) return exact;
	for (const d of dates) {
		if (d >= date) {
			const v = navByDate.get(d);
			if (v != null) return v;
		}
	}
	return null;
}

/**
 * 汇总单基金持仓收益。
 * 手续费按实际资金流处理：买入计入成本，卖出与分红冲减回款。
 */
export function summarizeHolding(
	resolved: ResolvedTransaction[],
	navHistory: NetWorthRecord[],
): HoldingSummary {
	let holdShares = 0;
	let totalInvested = 0;
	let totalBuyCost = 0;
	let totalBuyShares = 0;
	let totalDividend = 0;
	let firstBuyDate: string | null = null;
	for (const t of resolved) {
		if (t.pending) continue;
		const fee = t.fee || 0;
		if (t.type === 'buy') {
			holdShares += t.shares;
			// 买入手续费计入成本
			totalInvested += t.amount + fee;
			totalBuyCost += t.amount + fee;
			totalBuyShares += t.shares;
			if (firstBuyDate == null || t.date < firstBuyDate) firstBuyDate = t.date;
		} else if (t.type === 'sell') {
			holdShares -= t.shares;
			// 卖出手续费冲减回款
			totalInvested -= t.amount - fee;
		} else if (t.type === 'dividend') {
			// 分红手续费冲减到账金额
			totalDividend += t.amount - fee;
		}
	}
	if (holdShares < 0) holdShares = 0;

	const latest = navHistory.length > 0 ? navHistory[navHistory.length - 1]! : null;
	const prev = navHistory.length > 1 ? navHistory[navHistory.length - 2]! : null;
	const navAvailable = latest != null;
	const latestNav = latest ? latest.netWorth : 0;
	const navDate = latest ? latest.date : '';
	const todayChange = latest ? (latest.netWorthChange ?? 0) / 100 : 0;

	const holdAmount = holdShares * latestNav;
	const totalProfit = holdAmount - totalInvested + totalDividend;
	// 分母不能用净投入：卖出回笼资金已体现在收益金额里，再从中扣除会让减仓后收益率虚高、清仓后分母变负
	const totalProfitRate = totalBuyCost > 0 ? totalProfit / totalBuyCost : 0;

	const avgCostPerShare = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;
	const holdingCostBasis = avgCostPerShare * holdShares;
	const holdingProfit = holdAmount - holdingCostBasis;
	const holdingProfitRate = holdingCostBasis > 0 ? holdingProfit / holdingCostBasis : 0;

	const prevNav = prev ? prev.netWorth : latestNav;
	const todayProfit = holdShares * prevNav * todayChange;

	let holdDays = 0;
	if (firstBuyDate) {
		const firstTime = new Date(firstBuyDate + 'T00:00:00Z').getTime();
		const refTime = latest ? new Date(latest.date + 'T00:00:00Z').getTime() : Date.now();
		const diff = refTime - firstTime;
		if (Number.isFinite(diff)) holdDays = Math.max(0, Math.floor(diff / 86_400_000));
	}

	return {
		holdShares,
		totalInvested,
		holdAmount,
		totalProfit,
		totalDividend,
		totalProfitRate,
		todayChange,
		todayProfit,
		avgCostPerShare,
		holdingProfit,
		holdingProfitRate,
		latestNav,
		navDate,
		navAvailable,
		holdDays,
	};
}

/** 将净值历史序列化为 date→nav 映射，供补全时定位 */
export function toNavByDate(navHistory: NetWorthRecord[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const r of navHistory) {
		if (r.netWorth > 0 && !map.has(r.date)) map.set(r.date, r.netWorth);
	}
	return map;
}