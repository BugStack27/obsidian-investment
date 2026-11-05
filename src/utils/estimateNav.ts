import { todayKey } from '../services/signalAlerts';
import type { RealtimeEstimate } from '../services/realtimeEstimate';

/**
 * 取某基金"当日有效"的实时估值（净值 + 日期）。
 * 盘中估算只在估值日期等于今天时才有意义；否则（周末/非交易时段未更新）返回 null 以便回退昨日净值。
 * 作为信号判断与趋势通道灰色末点的唯一取值入口，避免各处重复判断。
 */
export function todayEstimateNav(
	estimates: Map<string, RealtimeEstimate>,
	code: string,
): { date: string; nav: number } | null {
	const est = estimates.get(code);
	if (!est || est.date !== todayKey()) return null;
	return { date: est.date, nav: est.gsz };
}