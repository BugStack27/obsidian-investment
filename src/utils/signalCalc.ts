import type { NetWorthRecord } from '../types';
import type { TrendChannelConfigValues } from '../ui/charts/trendChannel';
import { calcTrendChannel } from './indicatorCalc';

/** 持仓成本信息 */
export interface CostInfo {
	/** 持仓成本线 = 加权平均买入成本（元/份） */
	holdingCost: number | null;
	/** 累计成本线 = 净投入 / 持有份额（元/份）；无持仓时为 null */
	cumulativeCost: number | null;
}

export interface SignalDetail {
	type: 'buy' | 'sell';
	latestNav: number;
	holdingCost: number;
	cumulativeCost: number | null;
	costPct: number;
	cumCostPct: number | null;
}

/**
 * 基于趋势通道 + 持仓成本线判断今日买卖信号。
 * 与移动端 signalCalc.ts 口径一致：
 * 买入 = 最新估值低于持仓成本 且 低于通道下轨；卖出 = 高于持仓成本 且 高于通道上轨。
 */
export function computeTrendChannelSignal(
	netWorths: NetWorthRecord[],
	costInfo: CostInfo,
	config: TrendChannelConfigValues,
	estimatedNav?: number | null,
): SignalDetail | null {
	if (netWorths.length === 0) return null;

	const result = calcTrendChannel(
		netWorths.map((r) => ({ date: r.date, nav: r.netWorth })),
		{
			avg: { type: config.avgType, period: config.avgDays },
			std: { type: config.stdType, period: config.avgDays },
		},
	);
	const pts = result.points;
	if (pts.length === 0) return null;

	const latestNav = estimatedNav ?? netWorths[netWorths.length - 1]!.netWorth;
	if (latestNav == null) return null;

	let lower: number | null = null;
	let upper: number | null = null;
	for (let i = pts.length - 1; i >= 0; i--) {
		if (lower == null && pts[i]!.lower != null) lower = pts[i]!.lower;
		if (upper == null && pts[i]!.upper != null) upper = pts[i]!.upper;
		if (lower != null && upper != null) break;
	}
	if (lower == null || upper == null) return null;

	const { holdingCost, cumulativeCost } = costInfo;
	if (holdingCost == null) return null;

	const costPct = ((latestNav - holdingCost) / holdingCost) * 100;
	const cumCostPct =
		cumulativeCost != null && cumulativeCost > 0
			? ((latestNav - cumulativeCost) / cumulativeCost) * 100
			: null;

	const isBuy = latestNav < holdingCost && latestNav < lower;
	const isSell = latestNav > holdingCost && latestNav > upper;
	if (!isBuy && !isSell) return null;

	return { type: isBuy ? 'buy' : 'sell', latestNav, holdingCost, cumulativeCost, costPct, cumCostPct };
}