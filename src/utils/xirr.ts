import type { ResolvedTransaction } from '../types';

/** 一条现金流：date YYYY-MM-DD，amount 单位为元（买入为负、卖出/分红/期末市值为正） */
export interface CashFlow {
	date: string;
	amount: number;
}

/** 两个日期相差的天数（按 UTC，避免本地时区偏移） */
function daysBetween(start: string, date: string): number {
	return (
		(new Date(date + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime()) /
		86_400_000
	);
}

/**
 * 求解 XIRR（内部收益率）：使 Σ cash / (1 + r)^(t/365) = 0 的年化利率 r（小数）。
 * 使用带多种初值的牛顿迭代，任意情况失败返回 null。
 */
export function xirr(cashflows: CashFlow[]): number | null {
	if (cashflows.length < 2) return null;
	const hasNegative = cashflows.some((c) => c.amount < 0);
	const hasPositive = cashflows.some((c) => c.amount > 0);
	if (!hasNegative || !hasPositive) return null;

	const startDate = cashflows
		.map((c) => c.date)
		.sort((a, b) => (a < b ? -1 : 1))[0]!;
	const flows = cashflows.map((c) => ({
		years: daysBetween(startDate, c.date) / 365,
		amount: c.amount,
	}));

	const EPS = 1e-8;
	const MAX_ITER = 100;
	for (const guess of [0.1, 0.01, 0.3, -0.05, 0.6]) {
		let rate = guess;
		for (let i = 0; i < MAX_ITER; i++) {
			if (rate <= -0.9999) rate = -0.5;
			let f = 0;
			let df = 0;
			for (const fl of flows) {
				const denom = Math.pow(1 + rate, fl.years);
				f += fl.amount / denom;
				// dNPV/dr = -Σ cash·years / (1+r)^(years+1)
				df -= (fl.amount * fl.years) / (denom * (1 + rate));
			}
			if (Math.abs(f) < EPS) return rate;
			if (Math.abs(df) < 1e-12) break;
			const next = rate - f / df;
			if (!Number.isFinite(next)) break;
			if (Math.abs(next - rate) < EPS) return next;
			rate = next;
		}
	}
	return null;
}

/**
 * 由解析后的交易 + 期末市值构建现金流序列。
 * - 买入 → 负现金流（金额 + 手续费）；卖出/分红 → 正现金流（金额 − 手续费）；期末市值（持有份额 > 0）→ 期末正现金流
 */
export function buildCashFlows(
	resolved: ResolvedTransaction[],
	holdShares: number,
	holdAmount: number,
	navDate: string,
): CashFlow[] {
	const flows: CashFlow[] = [];
	for (const t of resolved) {
		if (t.pending) continue;
		const fee = t.fee || 0;
		if (t.type === 'buy') flows.push({ date: t.date, amount: -(t.amount + fee) });
		else if (t.type === 'sell') flows.push({ date: t.date, amount: t.amount - fee });
		else if (t.type === 'dividend') flows.push({ date: t.date, amount: t.amount - fee });
	}
	if (holdShares > 0 && holdAmount > 0 && navDate) {
		flows.push({ date: navDate, amount: holdAmount });
	}
	return flows;
}

/**
 * 由解析后的交易 + 期末市值计算年化收益率（小数）。
 * 缺一正一负、记录不足等不可算时返回 null。
 */
export function calcAnnualRate(
	resolved: ResolvedTransaction[],
	holdShares: number,
	holdAmount: number,
	navDate: string,
): number | null {
	return xirr(buildCashFlows(resolved, holdShares, holdAmount, navDate));
}