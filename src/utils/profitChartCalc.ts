import type { NetWorthRecord, ResolvedTransaction } from '../types';

function fmtMoney(v: number): string {
	return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface DailyProfitResult {
	/** 每日累计收益（元）：持有份额 × 单位净值 − 累计净投入 */
	profits: number[];
	/** 每日持有收益（元）：持有份额 × 单位净值 − 持有份额 × 加权持仓成本 */
	holdingProfits: number[];
	/** 与净值序列一一对应的日期标签 */
	xLabels: string[];
	/** 最末收益标注（+¥x.xx / -¥x.xx），复刻移动端 endLabel */
	endLabel: string;
}

/**
 * 收益走势：与 invest-app 移动端 profitChartCalc.ts 完全一致的口径。
 * 累计收益沿净值日推进，买入累加份额与投入、卖出扣减份额与投入，分红不影响份额与投入。
 */
export function calcDailyProfits(
	netWorths: NetWorthRecord[],
	transactions: ResolvedTransaction[],
): DailyProfitResult | null {
	if (netWorths.length === 0) return null;

	const sortedTxns = [...transactions]
		.filter((t) => !t.pending && (t.type === 'buy' || t.type === 'sell'))
		.sort((a, b) => a.date.localeCompare(b.date));

	let cumShares = 0;
	let cumInvested = 0;
	let totalBuyCost = 0;
	let totalBuyShares = 0;
	let txnIdx = 0;
	const profits: number[] = [];
	const holdingProfits: number[] = [];

	for (const rec of netWorths) {
		while (txnIdx < sortedTxns.length && sortedTxns[txnIdx]!.date <= rec.date) {
			const t = sortedTxns[txnIdx]!;
			if (t.type === 'buy') {
				cumShares += t.shares;
				cumInvested += t.amount;
				totalBuyCost += t.amount;
				totalBuyShares += t.shares;
			} else {
				cumShares -= t.shares;
				cumInvested -= t.amount;
			}
			txnIdx++;
		}
		profits.push(cumShares * rec.netWorth - cumInvested);
		const avgCost = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;
		holdingProfits.push(cumShares * rec.netWorth - cumShares * avgCost);
	}

	const lastProfit = profits[profits.length - 1]!;
	const endLabel = lastProfit >= 0 ? `+${fmtMoney(lastProfit)}` : fmtMoney(lastProfit);
	return { profits, holdingProfits, xLabels: netWorths.map((r) => r.date), endLabel };
}

export interface LastYearProfitResult {
	/** 近一年收益额 = 最新累计收益 - 一年前累计收益 */
	amount: number;
	/** 近一年收益率 = 近一年收益额 ÷ 一年前净投入（一年前投入为 0 时为 null） */
	rate: number | null;
	/** 一年前净投入 */
	baseInvested: number;
}

/**
 * 持仓投资的近一年收益（基于用户自己的交易与持仓，而非基金净值涨幅）。
 * 复刻 invest-app profitChartCalc.ts：口径为最新累计收益 - 一年前累计收益；
 * 收益率为相对一年前净投入的比例。基线取最新净值日往前推 365 天的首个（或之后最近）交易日。
 */
export function calcLastYearProfit(
	netWorths: NetWorthRecord[],
	transactions: ResolvedTransaction[],
): LastYearProfitResult | null {
	if (netWorths.length === 0) return null;
	const sortedTxns = [...transactions]
		.filter((t) => !t.pending && (t.type === 'buy' || t.type === 'sell'))
		.sort((a, b) => a.date.localeCompare(b.date));

	let cumShares = 0;
	let cumInvested = 0;
	let txnIdx = 0;
	const profits: number[] = [];
	const invested: number[] = [];
	for (const rec of netWorths) {
		while (txnIdx < sortedTxns.length && sortedTxns[txnIdx]!.date <= rec.date) {
			const t = sortedTxns[txnIdx]!;
			if (t.type === 'buy') {
				cumShares += t.shares;
				cumInvested += t.amount;
			} else {
				cumShares -= t.shares;
				cumInvested -= t.amount;
			}
			txnIdx++;
		}
		profits.push(cumShares * rec.netWorth - cumInvested);
		invested.push(cumInvested);
	}

	const last = netWorths.length - 1;
	const nowProfit = profits[last]!;

	// 一年前基线：最新净值日往前推 365 天后取首个（或之后最近）交易日
	const now = new Date(netWorths[last]!.date + 'T00:00:00');
	const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
	const cutoffStr = cutoff.toISOString().slice(0, 10);
	const baseIdx = netWorths.findIndex((r) => r.date >= cutoffStr);
	if (baseIdx < 0 || baseIdx > last) return null;

	const baseProfit = profits[baseIdx]!;
	const baseInvested = invested[baseIdx]!;
	const amount = nowProfit - baseProfit;
	return { amount, rate: baseInvested > 0 ? amount / baseInvested : null, baseInvested };
}