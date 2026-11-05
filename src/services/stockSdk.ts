import { StockSDK } from 'stock-sdk';
import { requestUrl } from 'obsidian';
import type { NetWorthRecord } from '../types';

let sdk: StockSDK | null = null;

export function getStockSdk(): StockSDK {
	if (!sdk) {
		sdk = new StockSDK({ timeout: 20000 });
	}
	return sdk;
}

interface CacheEntry<T> {
	expireAt: number;
	value: T;
}

const navCache = new Map<string, CacheEntry<NetWorthRecord[]>>();
const quoteCache = new Map<string, CacheEntry<{ nav: number; navDate: string }>>();
const stockQuoteCache = new Map<string, CacheEntry<StockQuote | null>>();
const stockKlineCache = new Map<string, CacheEntry<StockKlinePoint[]>>();
const stockValuationCache = new Map<string, CacheEntry<StockValuation[]>>();
const valuationAtCache = new Map<string, CacheEntry<StockValuationSnapshot | null>>();

function caching<T>(map: Map<string, CacheEntry<T>>, key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
	const hit = map.get(key);
	if (hit && hit.expireAt > Date.now()) return Promise.resolve(hit.value);
	return loader().then((value) => {
		map.set(key, { expireAt: Date.now() + ttlMs, value });
		return value;
	});
}

export function setCacheHours(hours: number): void {
	cacheHours = Math.max(1, Math.floor(hours));
}

let cacheHours = 6;
function navTtl(): number {
	return cacheHours * 3600_000;
}

/** 拉取基金全量净值历史（升序），失败抛错由调用方处理 */
export async function fetchFundNavHistory(code: string): Promise<NetWorthRecord[]> {
	return caching(
		navCache,
		code,
		navTtl(),
		async () => {
			const history = await getStockSdk().fund.navHistory(code);
			const records: NetWorthRecord[] = [];
			for (const it of history.items) {
				if (it.nav == null) continue;
				records.push({ date: it.date, netWorth: it.nav, netWorthChange: it.dailyReturn ?? 0 });
			}
			records.sort((a, b) => a.date.localeCompare(b.date));
			if (records.length === 0) throw new Error(`基金 ${code} 无净值数据`);
			return records;
		},
	);
}

/** 拉取基金最新单位净值（行情接口） */
export async function fetchLatestQuote(code: string): Promise<{ nav: number; navDate: string }> {
	return caching(
		quoteCache,
		code,
		10 * 60_000,
		async () => {
			const quotes = await getStockSdk().quotes.fund([code]);
			const q = quotes && quotes[0];
			if (!q || q.nav == null) return { nav: 0, navDate: '' };
			return { nav: q.nav, navDate: q.navDate };
		},
	);
}

/** 拉取基金深度资料（名称/费率/阶段收益/前十大重仓股等），失败返回 null */
export async function fetchFundProfile(code: string): Promise<FundProfileLike | null> {
	try {
		const p = await getStockSdk().fund.profile(code);
		return {
			code: p.code,
			name: p.name ?? p.code,
			rate: p.rate ?? null,
			sourceRate: p.sourceRate ?? null,
			minSubscription: p.minSubscription ?? null,
			stageReturns: p.stageReturns ?? null,
			holdings: (p.holdings ?? []).map((h) => ({ code: h.code, marketId: h.marketId })),
		};
	} catch {
		return null;
	}
}

export interface FundHoldingLike {
	/** 股票代码（纯数字 6 位） */
	code: string;
	/** 新市场号（"0"=深圳, "1"=上海） */
	marketId: string;
}

export interface FundProfileLike {
	code: string;
	name: string;
	rate: number | null;
	sourceRate: number | null;
	minSubscription: number | null;
	stageReturns: {
		oneMonth: number | null;
		threeMonth: number | null;
		sixMonth: number | null;
		oneYear: number | null;
	} | null;
	/** 前十大重仓股（可能滞后实际持仓约一个报告期） */
	holdings: FundHoldingLike[];
}

export interface FundSearchItem {
	code: string;
	name: string;
}

/** 搜索基金（仅基金类），返回归一化的 6 位代码与名称 */
export async function searchFunds(keyword: string, limit = 20): Promise<FundSearchItem[]> {
	const results = await getStockSdk().search(keyword);
	return results
		.filter((r) => r.category === 'fund')
		.slice(0, limit)
		.map((r) => ({ code: normalizeFundCode(r.code), name: r.name }));
}

/** 从搜索结果的完整代码（如 of011036 / sh510300）中提取 6 位基金代码 */
function normalizeFundCode(code: string): string {
	const digits = code.replace(/\D/g, '');
	return digits.length >= 6 ? digits.slice(0, 6) : digits;
}

export interface StockSearchItem {
	code: string;
	name: string;
}

/** 搜索 A 股股票（仅股票类），返回归一化的 6 位代码与名称 */
export async function searchStocks(keyword: string, limit = 20): Promise<StockSearchItem[]> {
	const results = await getStockSdk().search(keyword);
	return results
		.filter((r) => r.category === 'stock')
		.slice(0, limit)
		.map((r) => ({ code: stripMarketPrefix(r.code), name: r.name }));
}

/** 从完整代码（如 sh600519）中去掉市场前缀，取末尾 6 位 */
function stripMarketPrefix(code: string): string {
	const digits = code.replace(/\D/g, '');
	return digits.length >= 6 ? digits.slice(-6) : digits;
}

/** 股票实时行情（A股；code 支持 600519 / sh600519 等，SDK 内部归一化交易所前缀） */
export interface StockQuote {
	code: string;
	name: string;
	/** 最新价 */
	price: number;
	/** 昨收 */
	prevClose: number;
	/** 涨跌额 */
	change: number;
	/** 涨跌幅（%） */
	changePercent: number;
	/** 行情时间（原始字符串） */
	time: string;
}

/** 拉取股票实时行情，失败或停牌无价返回 null；60s 短缓存 */
export async function fetchStockQuote(code: string): Promise<StockQuote | null> {
	return caching(
		stockQuoteCache,
		code,
		60 * 1000,
		async () => {
			try {
				const quotes = await getStockSdk().quotes.cn([code]);
				const q = quotes && quotes[0];
				if (!q || q.price == null || q.price <= 0) return null;
				return {
					code,
					name: q.name || code,
					price: q.price,
					prevClose: q.prevClose || 0,
					change: q.change || 0,
					changePercent: q.changePercent || 0,
					time: q.time || '',
				};
			} catch {
				return null;
			}
		},
	);
}

/** 股票估值快照（持仓分析用）：PE(TTM) / PB 可能为 null（亏损股、停牌等） */
export interface StockValuation {
	code: string;
	name: string;
	pe: number | null;
	pb: number | null;
	/** 总市值（亿元）；无数据为 null */
	totalMarketCap: number | null;
}

/**
 * 批量拉取股票估值（PE(TTM)/PB），一次 `quotes.cn` 请求；10min 缓存。
 * 入参为空直接返回 [] 不发请求；上游失败抛错，由调用方兜底（区分「失败」与「无数据」）。
 */
export async function fetchStockValuations(codes: string[]): Promise<StockValuation[]> {
	if (codes.length === 0) return [];
	return caching(
		stockValuationCache,
		codes.join(','),
		10 * 60 * 1000,
		async () => {
			const quotes = await getStockSdk().quotes.cn(codes);
			return quotes.map((q) => ({
				code: stripMarketPrefix(q.code),
				name: q.name || stripMarketPrefix(q.code),
				pe: q.pe ?? null,
				pb: q.pb ?? null,
				totalMarketCap: q.totalMarketCap ?? null,
			}));
		},
	);
}

/** 个股历史估值快照（东财估值分析接口，按「该日或之前最近交易日」取值） */
export interface StockValuationSnapshot {
	code: string;
	name: string;
	/** 快照实际对应交易日 YYYY-MM-DD（非交易日/停牌自动前移） */
	date: string;
	/** PE(TTM) */
	peTtm: number | null;
	/** PB(MRQ) */
	pbMrq: number | null;
	/** 当日总市值（亿元） */
	totalMarketCap: number | null;
}

function toNumOrNull(v: unknown): number | null {
	if (v == null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function strOr(v: unknown, fallback: string): string {
	return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/**
 * 拉取单只股票在 `date`（含）之前最近交易日的估值快照（PE_TTM / PB_MRQ）。
 * 数据源为东财 datacenter 估值分析接口（stock-sdk 未封装，按需直连，仅持仓对比分析使用）；
 * 6h 缓存（历史数据稳定）；无数据（上市早于所选日期等）返回 null；网络失败抛错。
 * 用 Obsidian `requestUrl` 而非 fetch：renderer 内 fetch 受 CORS 限制。
 */
export async function fetchStockValuationAt(
	code: string,
	date: string,
): Promise<StockValuationSnapshot | null> {
	return caching(
		valuationAtCache,
		`${code}:${date}`,
		6 * 3600_000,
		async () => {
			const cols = 'SECURITY_CODE,SECURITY_NAME_ABBR,PE_TTM,PB_MRQ,TOTAL_MARKET_CAP,TRADE_DATE';
			const filter = `(SECURITY_CODE="${code}")(TRADE_DATE<='${date}')`;
			const url =
				'https://datacenter-web.eastmoney.com/api/data/v1/get' +
				`?reportName=RPT_VALUEANALYSIS_DET&columns=${encodeURIComponent(cols)}` +
				`&filter=${encodeURIComponent(filter)}` +
				'&sortColumns=TRADE_DATE&sortTypes=-1&pageSize=1&pageNumber=1&source=WEB&client=WEB';
			const res = await requestUrl({ url, method: 'GET' });
			if (res.status !== 200) throw new Error(`估值接口 HTTP ${res.status}`);
			const json = res.json as { result?: { data?: Array<Record<string, unknown>> } | null };
			const row = json.result?.data?.[0];
			if (!row) return null;
			return {
				code,
				name: strOr(row.SECURITY_NAME_ABBR, code),
				date: strOr(row.TRADE_DATE, date).slice(0, 10),
				peTtm: toNumOrNull(row.PE_TTM),
				pbMrq: toNumOrNull(row.PB_MRQ),
				totalMarketCap: toNumOrNull(row.TOTAL_MARKET_CAP),
			};
		},
	);
}

/**
 * 查询指定日期是否为 A 股交易日（stock-sdk 交易日历，含法定节假日识别）。
 * - `date` 不传则按「现在 Asia/Shanghai 的当日」判定；可传 'YYYY-MM-DD' / 'YYYYMMDD' / Date。
 * - **此处不做缓存**：每日缓存与失败兜底统一由 `services/tradingCalendar.ts` 负责，避免两处 TTL 口径。
 * - 上游请求失败时抛错，由调用方兜底。
 */
export async function fetchTradingDay(date?: string | Date): Promise<boolean> {
	return getStockSdk().calendar.isTradingDay(date);
}

/** K 线周期：日 / 周 / 月 */
export type StockKlinePeriod = 'daily' | 'weekly' | 'monthly';

export interface StockKlinePoint {
	date: string;
	open: number;
	close: number;
	high: number;
	low: number;
	volume: number;
}

/** 拉取股票前复权 K 线（日/周/月），按日期升序；30min 缓存 */
export async function fetchStockKline(
	code: string,
	period: StockKlinePeriod = 'daily',
): Promise<StockKlinePoint[]> {
	return caching(
		stockKlineCache,
		`${code}:${period}`,
		30 * 60 * 1000,
		async () => {
			try {
				const klines = await getStockSdk().kline.cn(code, { period, adjust: 'qfq' });
				const points = klines
					.filter((k) => k.open != null && k.close != null && k.high != null && k.low != null)
					.map((k) => ({
						date: k.date,
						open: k.open!,
						close: k.close!,
						high: k.high!,
						low: k.low!,
						volume: k.volume ?? 0,
					}));
				points.sort((a, b) => a.date.localeCompare(b.date));
				return points;
			} catch {
				return [];
			}
		},
	);
}