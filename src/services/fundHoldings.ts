import type { FundHoldingRow } from '../utils/holdingBlock';
import {
	fetchFundProfile,
	fetchStockValuationAt,
	fetchStockValuations,
	type StockValuationSnapshot,
} from './stockSdk';

/** 单只重仓股的估值快照；pe/pb 为 null 表示无数据（亏损股、停牌、无行情等） */
export interface HoldingValuationItem {
	code: string;
	name: string;
	pe: number | null;
	pb: number | null;
	/** 手动填写的占净值比（%，来自 fund-holding 块）；自动拉取的重仓股为 null */
	ratio: number | null;
	/** 总市值（亿元，实时行情）；无数据为 null */
	marketCap: number | null;
	/** 对比分析的「当时」PE(TTM)（选了日期才有值；该股无历史数据为 null） */
	peThen?: number | null;
	/** 对比分析的「当时」PB(MRQ) */
	pbThen?: number | null;
	/** 对比分析的「当时」总市值（亿元） */
	marketCapThen?: number | null;
}

/** 一只基金的持仓分析数据（前十大重仓股 + 手动补充 + 实时估值；展示顺序由图表侧按 PE 降序统一排列） */
export interface FundHoldingsAnalysis {
	fundCode: string;
	items: HoldingValuationItem[];
}

/**
 * 批量拉取若干股票在 `date`（含）之前最近交易日的估值快照（并行、各自 6h 缓存）。
 * 单只失败（网络/超时）按无数据处理（该股票对比柱为空），全部失败才抛错。
 */
export async function fetchValuationSnapshotsAt(
	codes: string[],
	date: string,
): Promise<StockValuationSnapshot[]> {
	const settled = await Promise.all(
		codes.map((code) => fetchStockValuationAt(code, date).catch(() => null)),
	);
	const snapshots = settled.filter((s): s is StockValuationSnapshot => s != null);
	if (snapshots.length === 0) throw new Error('历史估值拉取失败');
	return snapshots;
}

/** 单指标「当前 vs 当时」对比统计 */
export interface MetricCompareStat {
	/** 当前与当时均有值的股票数（参与统计的配对数） */
	count: number;
	curAvg: number | null;
	thenAvg: number | null;
	/** 平均变化量（当前 - 当时） */
	delta: number | null;
	/** 平均变化百分比（%）；当时均值为 0 时为 null */
	deltaPct: number | null;
	/** 当前较当时上升 / 下降家数（相等不计） */
	up: number;
	down: number;
}

/** 持仓估值对比结论（PE / PB / PE×PB 三指标） */
export interface ValuationCompareStats {
	pe: MetricCompareStat;
	pb: MetricCompareStat;
	pepb: MetricCompareStat;
}

function metricStat(
	items: HoldingValuationItem[],
	cur: (it: HoldingValuationItem) => number | null,
	then: (it: HoldingValuationItem) => number | null,
): MetricCompareStat {
	const pairs = items
		.map((it) => ({ c: cur(it), t: then(it) }))
		.filter((p): p is { c: number; t: number } => p.c != null && p.t != null);
	if (pairs.length === 0) {
		return { count: 0, curAvg: null, thenAvg: null, delta: null, deltaPct: null, up: 0, down: 0 };
	}
	const curAvg = pairs.reduce((a, p) => a + p.c, 0) / pairs.length;
	const thenAvg = pairs.reduce((a, p) => a + p.t, 0) / pairs.length;
	return {
		count: pairs.length,
		curAvg,
		thenAvg,
		delta: curAvg - thenAvg,
		deltaPct: thenAvg !== 0 ? ((curAvg - thenAvg) / Math.abs(thenAvg)) * 100 : null,
		up: pairs.filter((p) => p.c > p.t).length,
		down: pairs.filter((p) => p.c < p.t).length,
	};
}

/** 计算持仓估值对比结论（仅统计当前与当时均有值的股票） */
export function computeValuationCompareStats(items: HoldingValuationItem[]): ValuationCompareStats {
	const pepb = (pe: number | null, pb: number | null): number | null =>
		pe != null && pb != null ? pe * pb : null;
	return {
		pe: metricStat(items, (it) => it.pe, (it) => it.peThen ?? null),
		pb: metricStat(items, (it) => it.pb, (it) => it.pbThen ?? null),
		pepb: metricStat(
			items,
			(it) => pepb(it.pe, it.pb),
			(it) => pepb(it.peThen ?? null, it.pbThen ?? null),
		),
	};
}

/** 阈值分布统计：低于某阈值的持仓市值占全部持仓市值的比例 */
export interface ThresholdShareStat {
	/** 低于阈值且有市值数据的只数 */
	belowCount: number;
	/** 低于阈值的市值合计（亿元） */
	belowCap: number;
	/** 有市值数据的全部只数（分母） */
	totalCount: number;
	/** 全部持仓市值合计（亿元，分母） */
	totalCap: number;
	/** 占比（%）；无市值数据为 null */
	ratio: number | null;
}

/**
 * PE/PB 阈值分布统计（PE<15、PE<30、PB<1.5、PB<3、PE×PB<22.5、PE×PB<45）。
 * 乘积字段名里的 225 即 22.5（标识符不能带小数点）。
 */
export interface ValuationThresholdStats {
	pe15: ThresholdShareStat;
	pe30: ThresholdShareStat;
	pb15: ThresholdShareStat;
	pb3: ThresholdShareStat;
	pepb225: ThresholdShareStat;
	pepb45: ThresholdShareStat;
}

function thresholdShare(
	items: HoldingValuationItem[],
	metric: (it: HoldingValuationItem) => number | null,
	cap: (it: HoldingValuationItem) => number | null,
	threshold: number,
): ThresholdShareStat {
	const withCap = items.filter((it) => cap(it) != null);
	const totalCap = withCap.reduce((a, it) => a + (cap(it) ?? 0), 0);
	const below = withCap.filter((it) => {
		const v = metric(it);
		return v != null && v < threshold;
	});
	const belowCap = below.reduce((a, it) => a + (cap(it) ?? 0), 0);
	return {
		belowCount: below.length,
		belowCap,
		totalCount: withCap.length,
		totalCap,
		ratio: totalCap > 0 ? (belowCap / totalCap) * 100 : null,
	};
}

/** 统计口径：当前实时估值 / 对比日期的历史估值 */
export type ThresholdStatScope = 'current' | 'then';

/**
 * 计算阈值分布：PE<15/30、PB<1.5/3、PE×PB<22.5/45 的市值占比；scope 选当前或当时。
 * PB 两档取 1.5 / 3（而非 1 / 2）：破净（PB<1）在 A 股只占一成出头，
 * 与 PE<15 的难度不在同一档，放进同一档会让 PB 子项系统性偏低、且行业一集中就恒定 0。
 * PE×PB 谨慎档 22.5 = 15×1.5（格雷厄姆标准），激进档按 2 倍放宽取 45；
 * 不用 30×3=90 是因为该阈值几乎无筛选力。
 */
export function computeThresholdStats(
	items: HoldingValuationItem[],
	scope: ThresholdStatScope = 'current',
): ValuationThresholdStats {
	const then = scope === 'then';
	const pe = (it: HoldingValuationItem): number | null => (then ? it.peThen ?? null : it.pe);
	const pb = (it: HoldingValuationItem): number | null => (then ? it.pbThen ?? null : it.pb);
	const cap = (it: HoldingValuationItem): number | null =>
		then ? it.marketCapThen ?? null : it.marketCap;
	const pepb = (it: HoldingValuationItem): number | null => {
		const p = pe(it);
		const b = pb(it);
		return p != null && b != null ? p * b : null;
	};
	return {
		pe15: thresholdShare(items, pe, cap, 15),
		pe30: thresholdShare(items, pe, cap, 30),
		pb15: thresholdShare(items, pb, cap, 1.5),
		pb3: thresholdShare(items, pb, cap, 3),
		pepb225: thresholdShare(items, pepb, cap, 22.5),
		pepb45: thresholdShare(items, pepb, cap, 45),
	};
}

/** 单个子项的安全度统计（阈值占比 + 该指标的有效市值覆盖度） */
export interface SafetyMetricScore {
	/** 低于阈值的市值占比等统计 */
	stat: ThresholdShareStat;
	/** 该指标的有效市值占全部持仓市值比例（%）；全部无市值时为 null */
	coverage: number | null;
}

/** 一档口径（谨慎/激进）的安全度评分 */
export interface SafetyTierScore {
	/** 加权得分 0–100；三个子项全无数据为 null */
	score: number | null;
	pe: SafetyMetricScore;
	pb: SafetyMetricScore;
	pepb: SafetyMetricScore;
}

/** 持仓安全度：谨慎档（PE<15 / PB<1.5 / PE×PB<22.5）与激进档（PE<30 / PB<3 / PE×PB<45） */
export interface SafetyScore {
	conservative: SafetyTierScore;
	aggressive: SafetyTierScore;
}

/** 子项权重：PE 50%、PB 30%、PE×PB 20%（PB 与 PE 非独立维度，且行业集中时易恒定，故权重低于 PE） */
const SAFETY_WEIGHT = { pe: 0.5, pb: 0.3, pepb: 0.2 } as const;

/** 按权重加权；无数据的子项不参与（权重在剩余子项内归一化，避免把"无数据"算成 0 分） */
function weightedSafetyScore(
	parts: Array<{ stat: ThresholdShareStat; weight: number }>,
): number | null {
	let sum = 0;
	let weight = 0;
	for (const p of parts) {
		if (p.stat.ratio == null) continue;
		sum += p.stat.ratio * p.weight;
		weight += p.weight;
	}
	return weight > 0 ? sum / weight : null;
}

/**
 * 计算持仓安全度评分（市值口径）：
 * 谨慎 = 0.5×PE<15 占比 + 0.3×PB<1.5 占比 + 0.2×PE×PB<22.5 占比；
 * 激进 = 0.5×PE<30 占比 + 0.3×PB<3 占比 + 0.2×PE×PB<45 占比。
 * 得分与占比同为 0–100；`scope` 选当前实时估值或对比日期的历史估值。
 */
export function computeSafetyScore(
	items: HoldingValuationItem[],
	scope: ThresholdStatScope = 'current',
): SafetyScore {
	const stats = computeThresholdStats(items, scope);
	const cap = (it: HoldingValuationItem): number | null =>
		scope === 'then' ? it.marketCapThen ?? null : it.marketCap;
	// 全部持仓市值（含该指标无数据的股票）：作为覆盖度分母
	const allCap = items.reduce((a, it) => a + (cap(it) ?? 0), 0);
	const wrap = (stat: ThresholdShareStat): SafetyMetricScore => ({
		stat,
		coverage: allCap > 0 ? (stat.totalCap / allCap) * 100 : null,
	});
	const tier = (
		pe: ThresholdShareStat,
		pb: ThresholdShareStat,
		pepb: ThresholdShareStat,
	): SafetyTierScore => ({
		score: weightedSafetyScore([
			{ stat: pe, weight: SAFETY_WEIGHT.pe },
			{ stat: pb, weight: SAFETY_WEIGHT.pb },
			{ stat: pepb, weight: SAFETY_WEIGHT.pepb },
		]),
		pe: wrap(pe),
		pb: wrap(pb),
		pepb: wrap(pepb),
	});
	return {
		conservative: tier(stats.pe15, stats.pb15, stats.pepb225),
		aggressive: tier(stats.pe30, stats.pb3, stats.pepb45),
	};
}

/**
 * 加载单只基金的持仓分析数据：
 * fund.profile 取前十大重仓股 → 合并笔记 ```fund-holding``` 块的手动持仓（去重）→
 * 一次批量行情拉取 PE(TTM)/PB → 合并。
 * `manualRows` 仅「当前持仓」行参与图表；与自动持仓按代码去重（重复代码的名称/比例仍生效，用于补充自动数据）。
 * profile 失败或为空时，若有手动持仓则用手动数据继续（手动-only）；两者均空返回 null。
 * 行情失败抛错由调用方兜底。
 */
export async function loadFundHoldingsAnalysis(
	fundCode: string,
	manualRows: FundHoldingRow[] = [],
): Promise<FundHoldingsAnalysis | null> {
	const profile = await fetchFundProfile(fundCode);

	// 手动行按代码归并（含与自动重复的：名称/比例用于补充自动数据）
	const manualByCode = new Map<string, FundHoldingRow>();
	for (const row of manualRows) {
		if (!row.active) continue;
		const code = row.code.trim();
		if (code && !manualByCode.has(code)) manualByCode.set(code, row);
	}

	// 合并代码列表：自动重仓股在前（去重/滤空/保序），手动补充追加在后
	const codes: string[] = [];
	const seen = new Set<string>();
	if (profile) {
		for (const h of profile.holdings) {
			const code = h.code.trim();
			if (!code || seen.has(code)) continue;
			seen.add(code);
			codes.push(code);
		}
	}
	for (const [code] of manualByCode) {
		if (!seen.has(code)) {
			seen.add(code);
			codes.push(code);
		}
	}
	if (codes.length === 0) return null;

	const valuations = await fetchStockValuations(codes);
	const byCode = new Map(valuations.map((v) => [v.code, v]));

	const items: HoldingValuationItem[] = codes.map((code) => {
		const v = byCode.get(code);
		const m = manualByCode.get(code);
		return {
			code,
			// 名称回退链：行情名 → 手动填写的名称 → 代码（无行情不丢分类，图表侧画占位标记）
			name: v?.name || m?.name || code,
			pe: v?.pe ?? null,
			pb: v?.pb ?? null,
			ratio: m?.ratio ?? null,
			marketCap: v?.totalMarketCap ?? null,
		};
	});
	return { fundCode, items };
}
