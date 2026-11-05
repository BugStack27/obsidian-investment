import { fetchTradingDay } from './stockSdk';
import { todayKey } from './signalAlerts';

/**
 * A 股交易日历：为买卖信号与盘中估值提供统一的「今天是不是交易日」判定。
 *
 * 上游为 stock-sdk 的 `calendar.isTradingDay()`（含法定节假日识别），但它是异步网络请求，
 * 故本模块负责两件事：**按自然日缓存**（每天最多一次请求）与**失败兜底**（回退周一至周五）。
 */

/**
 * 保守回退：周一至周五视为交易日（不识别法定节假日）。
 * 判定接口失败时使用——漏报（该提醒没提醒）比误报危害更大。
 */
export function isWeekdayTradingFallback(d = new Date()): boolean {
	const day = d.getDay();
	return day !== 0 && day !== 6;
}

/** A 股交易时段（周一至周五 9:30-15:00）；纯本地时间判断，不含节假日识别，需与交易日判定配合使用 */
export function isTradingSession(d = new Date()): boolean {
	if (!isWeekdayTradingFallback(d)) return false;
	const minutes = d.getHours() * 60 + d.getMinutes();
	return minutes >= 9 * 60 + 30 && minutes <= 15 * 60;
}

/** 回退值（临时结果）的重试间隔 */
const FALLBACK_RETRY_MS = 10 * 60 * 1000;

interface TradingDayCache {
	/** 缓存归属的自然日 YYYY-MM-DD */
	date: string;
	value: boolean;
	/** 是否为失败回退值（true 时需按 TTL 重试） */
	provisional: boolean;
	/** provisional 时的重试时刻（毫秒时间戳） */
	expireAt: number;
}

let cache: TradingDayCache | null = null;
/** 同一时刻的并发调用共享同一次请求 */
let inflight: Promise<boolean> | null = null;

/**
 * 今日是否为 A 股交易日（含法定节假日）。
 *
 * - 成功结果按自然日缓存，跨天自动失效并重新请求；
 * - 判定失败时回退 `isWeekdayTradingFallback` 并标记为临时值，10 分钟后重试，成功后退化为全天缓存；
 * - 缓存命中时零成本，可安全地在每次刷新时调用。
 */
export async function isTradingDayToday(now = new Date()): Promise<boolean> {
	const today = todayKey(now);
	const hit = cache;
	if (hit && hit.date === today && (!hit.provisional || hit.expireAt > now.getTime())) {
		return hit.value;
	}
	if (inflight) return inflight;

	inflight = resolveTradingDay(today, now).finally(() => {
		inflight = null;
	});
	return inflight;
}

async function resolveTradingDay(today: string, now: Date): Promise<boolean> {
	try {
		const value = await fetchTradingDay(now);
		cache = { date: today, value, provisional: false, expireAt: 0 };
		return value;
	} catch {
		const value = isWeekdayTradingFallback(now);
		cache = { date: today, value, provisional: true, expireAt: now.getTime() + FALLBACK_RETRY_MS };
		return value;
	}
}
