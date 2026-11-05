/*
趋势通道指标计算：与 invest-app 移动端 indicatorCalc.ts 完全一致。
均线(SMA/EMA) + 残差标准差(滚动/全局)，构成净值上/下通道。
*/

export function calcSMA(values: number[], period: number): (number | null)[] {
	if (period <= 0 || values.length === 0) return [];
	const result: (number | null)[] = [];
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i]!;
		if (i >= period) sum -= values[i - period]!;
		result.push(i >= period - 1 ? sum / period : null);
	}
	return result;
}

export function calcEMA(values: number[], period: number): (number | null)[] {
	if (period <= 0 || values.length === 0) return [];
	const alpha = 2 / (period + 1);
	const result: (number | null)[] = [];
	let ema = values[0]!;
	result.push(ema);
	for (let i = 1; i < values.length; i++) {
		ema = alpha * values[i]! + (1 - alpha) * ema;
		result.push(ema);
	}
	return result;
}

function calcGlobalStd(values: number[]): number {
	if (values.length === 0) return 0;
	const mean = values.reduce((s, v) => s + v, 0) / values.length;
	const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
	return Math.sqrt(variance);
}

export interface TrendChannelConfig {
	avg: { type: 'sma' | 'ema'; period: number };
	std: { type: 'rolling' | 'global'; period: number };
}

export interface TrendChannelResultPoint {
	date: string;
	nav: number;
	avg: number | null;
	upper: number | null;
	lower: number | null;
}

export interface TrendChannelResult {
	points: TrendChannelResultPoint[];
	stdValue: number | null;
	config: TrendChannelConfig;
}

/** 对残差序列计算滚动标准差（跳过 null 值） */
function calcRollingStdFromResiduals(residuals: (number | null)[], period: number): (number | null)[] {
	if (period <= 0 || residuals.length === 0) return [];
	const result: (number | null)[] = [];
	for (let i = 0; i < residuals.length; i++) {
		if (residuals[i] === null) {
			result.push(null);
			continue;
		}
		const slice: number[] = [];
		for (let j = i; j >= 0 && slice.length < period; j--) {
			if (residuals[j] !== null) slice.unshift(residuals[j]!);
		}
		if (slice.length < 2) {
			result.push(null);
			continue;
		}
		const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
		const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
		result.push(Math.sqrt(variance));
	}
	return result;
}

/** 完整计算趋势通道 */
export function calcTrendChannel(points: { date: string; nav: number }[], config: TrendChannelConfig): TrendChannelResult {
	const values = points.map((p) => p.nav);
	const dates = points.map((p) => p.date);
	const { avg, std } = config;

	const avgLine = avg.type === 'sma' ? calcSMA(values, avg.period) : calcEMA(values, avg.period);

	// 残差 = 每日净值 - 当日均线
	const residuals: (number | null)[] = values.map((v, i) => {
		const a = avgLine[i];
		return a == null ? null : v - a;
	});

	let stdValue: number | null = null;
	let stdLine: (number | null)[];
	if (std.type === 'rolling') {
		const rollingPeriod = std.period > 0 ? std.period : avg.period;
		stdLine = calcRollingStdFromResiduals(residuals, rollingPeriod);
	} else {
		const validResiduals = residuals.filter((r): r is number => r !== null);
		const allResiduals = std.period > 0 ? validResiduals.slice(-std.period) : validResiduals;
		stdValue = allResiduals.length > 0 ? calcGlobalStd(allResiduals) : 0;
		stdLine = values.map(() => stdValue!);
	}

	const result = values.map((nav, i) => {
		const avgVal = avgLine[i] ?? null;
		const stdVal = stdLine[i] ?? null;
		return {
			date: dates[i] || '',
			nav,
			avg: avgVal,
			upper: avgVal != null && stdVal != null ? avgVal + stdVal : null,
			lower: avgVal != null && stdVal != null ? avgVal - stdVal : null,
		};
	});

	return { points: result, stdValue, config };
}