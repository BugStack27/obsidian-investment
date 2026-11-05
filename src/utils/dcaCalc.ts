import type { NetWorthRecord, ResolvedTransaction } from '../types';
import type { CashFlow } from './xirr';
import { xirr } from './xirr';

/** 定投年化计算结果 */
export interface DcaAnnualResult {
	/** 定投年化收益率（小数，XIRR 计算结果）*/
	annualRate: number;
	/** 每交易日定投金额（总买入额 ÷ 定投交易日数）*/
	perDayAmount: number;
	/** 定投交易日数（首次买入到最新净值之间有多少个交易日）*/
	tradingDays: number;
}

/**
 * 计算"定投年化收益率"：无脑定投策略对比（总买入额均摊到每个交易日，每个交易日买相同金额，XIRR 计算年化）
 * @param resolved - 解析后的交易列表（已补全净值）
 * @param navHistory - 基金净值历史（从首次开盘到最新）
 * @returns 计算结果或 null（无法计算时）
 *
 * 计算逻辑（根据需求澄清）：
 * 1. 定投区间：从首次买入日 → 最新净值日（整个持仓区间）
 * 2. 定投总金额：所有买入交易金额之和（忽略卖出和分红，纯买入模拟）
 * 3. 每交易日定投额 = 总金额 ÷ 定投区间交易日数
 * 4. 对区间内每个交易日都做一笔买入，累计份额，期末市值用最新净值估值
 * 5. 对所有定投现金流 + 期末市值现金流，用 XIRR 计算年化收益率
 */
export function calcDcaAnnual(
	resolved: ResolvedTransaction[],
	navHistory: NetWorthRecord[],
): DcaAnnualResult | null {
	// 1. 找到首次买入日期
	const buys = resolved.filter(t => !t.pending && t.type === 'buy');
	if (buys.length === 0) return null;

	// 首次买入日（最小日期）
	let firstBuyDate = buys[0]!.date;
	for (const b of buys) {
		if (b.date < firstBuyDate) firstBuyDate = b.date;
	}

	// 总买入金额求和
	const totalBuySum = buys.reduce((sum, b) => sum + b.amount, 0);

	if (navHistory.length === 0) return null;
	const latest = navHistory[navHistory.length - 1]!;
	const latestDate = latest.date;

	// 2. 筛选定投区间内的交易日：firstBuyDate ≤ date ≤ latestDate
	const dcaDays = navHistory.filter(r => r.date >= firstBuyDate && r.date <= latestDate);
	// 定投交易日不足（XIRR 至少需要一笔投入 + 一笔期末，单日会得到无意义初值）
	if (dcaDays.length < 2) return null;

	// 3. 每交易日定投额
	const perDay = totalBuySum / dcaDays.length;
	let totalShares = 0;

	// 4. 累计份额：每天买 perDay / nav
	for (const day of dcaDays) {
		if (day.netWorth > 0) {
			totalShares += perDay / day.netWorth;
		}
	}

	if (totalShares <= 0) return null;

	// 5. 期末市值
	const finalValue = totalShares * latest.netWorth;

	// 6. 构建现金流：每个定投交易日一条负现金流 (-perDay)，期末一条正现金流 (+finalValue)
	const flows: CashFlow[] = [];
	for (const day of dcaDays) {
		if (day.netWorth > 0) {
			flows.push({ date: day.date, amount: -perDay });
		}
	}
	flows.push({ date: latestDate, amount: finalValue });

	// 7. XIRR 计算年化
	const annualRate = xirr(flows);
	if (annualRate == null) return null;

	return {
		annualRate,
		perDayAmount: perDay,
		tradingDays: dcaDays.length,
	};
}
