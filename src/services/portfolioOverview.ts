import { App } from 'obsidian';
import type { NetWorthRecord } from '../types';
import { DEFAULT_CHANNEL_CONFIG, type TrendChannelConfigValues } from '../ui/charts/trendChannel';
import { todayEstimateNav } from '../utils/estimateNav';
import { isFundNote, readFundNoteInfo } from '../utils/frontmatter';
import { computeTrendChannelSignal, type SignalDetail } from '../utils/signalCalc';
import { buildCashFlows, calcAnnualRate, xirr, type CashFlow } from '../utils/xirr';
import { loadFundAnalysisResult, type FundLoadFailure } from './fundAnalysis';
import { fetchRealtimeEstimates, type RealtimeEstimate } from './realtimeEstimate';
import { RECENT_TRADE_DAYS, shiftDateKey } from './recentTrades';
import { todayKey } from './signalAlerts';
import type { StockPortfolio } from './stockPortfolio';
import type { TodayTrade } from './todayTrades';

export interface PortfolioOverview {
	totalAssets: number;
	totalProfit: number;
	totalInvested: number;
	annualized: number;
	fundCount: number;
	/** 基金持仓市值合计（今日盈亏涨跌幅的分母，不含股票） */
	fundAssets: number;
	/** 有记录并纳入汇总的股票数（含已清仓） */
	stockCount: number;
	/** 股票持仓市值合计（元） */
	stockAssets: number;
	/** 股票累计收益合计（元） */
	stockProfit: number;
	/** 有持仓但行情不可用、未纳入统计的股票数 */
	unpricedStockCount: number;
	/** 今日盈亏合计（元，仅统计基金） */
	todayProfit: number;
	/**
	 * `todayProfit` 对应的**行情日期**（YYYY-MM-DD），决定 UI 该显示「今日」还是具体日期。
	 * - 盘中估值口径（`sumEstimatedTodayProfit` 有效）时为**当日**；
	 * - 净值口径（已结算）时为各基金最新净值日中**最早**的一个 —— 语义是「所有数据至少已结算到该日」，
	 *   取最早值而非最新值是为避免「个别基金提前更新净值」导致标签夸大行情新鲜度。
	 */
	todayProfitDate: string;
}

/** 单只基金的概览卡片（对齐移动端 LeftPanel 卡片） */
export interface FundCard {
	code: string;
	name: string;
	filePath: string;
	holdAmount: number;
	/** 累计投入 = Σ买入 − Σ卖出 */
	totalInvested: number;
	totalProfit: number;
	totalProfitRate: number;
	/** 今日盈亏（元） */
	todayProfit: number;
	/** 持有天数 */
	holdDays: number;
	/** 年化：持有满一年复利年化，不满一年取总收益率 */
	annual: number;
	todayChange: number;
	navDate: string | null;
	sparkline: number[];
	/**
	 * 今日买卖信号（无信号时为 null）。
	 * - **非交易日恒为 null**（不计算、不提醒，见 `tradingCalendar.isTradingDayToday`）；
	 * - **持有份额为 0 时恒为 null**（清仓基金不提醒）；
	 * - 仅作展示与计算，提醒链路另受 skipTradeNotify 约束。
	 */
	signal: SignalDetail | null;
	/** 记录块 fence 行设置了 skipTradeNotify：不参与买卖点提醒（信号仍照常计算） */
	skipTradeNotify: boolean;
}

export const EMPTY_OVERVIEW: PortfolioOverview = {
	totalAssets: 0,
	totalProfit: 0,
	totalInvested: 0,
	annualized: 0,
	fundCount: 0,
	fundAssets: 0,
	stockCount: 0,
	stockAssets: 0,
	stockProfit: 0,
	unpricedStockCount: 0,
	todayProfit: 0,
	todayProfitDate: '',
};

/** 今日收益在「行情日期为当日」时的标签（估值口径与当日净值口径共用） */
export const TODAY_PROFIT_TODAY_LABEL = '今日';

/**
 * 今日收益的显示标签：行情日期为当日时显示「今日」，否则显示 `MM-DD`。
 * 估值口径的 `date` 恒为当日，故自然显示「今日」；净值口径回退时显示该净值日期，
 * 避免非交易日 / 盘前把上一交易日的盈亏标成「今日」。
 */
export function todayProfitDateLabel(date: string, today = todayKey()): string {
	if (!date || date === today) return TODAY_PROFIT_TODAY_LABEL;
	return date.slice(5);
}

/** 暂存的单基金构建中间态：卡字段先填齐，signal 留待拿到当日估值后统一计算 */
interface PendingCard {
	card: Omit<FundCard, 'signal'>;
	navHistory: NetWorthRecord[];
	/** 持有份额：为 0 时不计算买卖信号（清仓基金不提醒） */
	holdShares: number;
	holdingCost: number;
	cumulativeCost: number | null;
	config: TrendChannelConfigValues;
}

/** buildFundCards 的构建选项 */
export interface BuildFundCardsOptions {
	/**
	 * 是否计算今日买卖信号，默认 `true`。
	 * 非交易日（`tradingCalendar.isTradingDayToday()` 为 false）时传 `false`：直接跳过
	 * `computeTrendChannelSignal`，卡片 `signal` 恒为 null，提醒链路自然为空。
	 */
	computeSignals?: boolean;
}

/**
 * 一次性构建基金卡片 + 统一拉取当日估值。返回 {cards, estimates, annualized, recentTrades, failedFunds}。
 * `computeSignals: false` 时不计算买卖信号（非交易日）。
 * `recentTrades` 为顺带收集的**近 `RECENT_TRADE_DAYS` 天**（自然日，含今天、不含未来日期）
 * 买入/卖出记录，供「近期操作」弹窗（含今日档）使用；复用本循环已加载的 `resolved`，
 * 不额外读盘、不额外请求净值。今日档为其 `date === today` 的子集，由弹窗派生。
 */
export async function buildFundCards(
	app: App,
	configs: Record<string, TrendChannelConfigValues> = {},
	options: BuildFundCardsOptions = {},
): Promise<{
	cards: FundCard[];
	estimates: Map<string, RealtimeEstimate>;
	/** 全组合统一年化（XIRR，所有基金现金流合并）；不可算时 null */
	annualized: number | null;
	/** 近 `RECENT_TRADE_DAYS` 天的买入/卖出记录（基金部分，含交易日期），未排序 */
	recentTrades: TodayTrade[];
	/** 有记录但加载失败、未纳入统计的基金（按名称升序） */
	failedFunds: FundLoadFailure[];
}> {
	const computeSignals = options.computeSignals !== false;
	// 入口处取一次今日与窗口起点，避免长循环跨零点导致同批数据混用两个日期
	const today = todayKey();
	const since = shiftDateKey(today, -(RECENT_TRADE_DAYS - 1));
	const seen = new Set<string>();
	const codes: string[] = [];
	const pending: PendingCard[] = [];
	const allFlows: CashFlow[] = [];
	const recentTrades: TodayTrade[] = [];
	const failedFunds: FundLoadFailure[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const info = readFundNoteInfo(app.metadataCache.getFileCache(file)?.frontmatter);
		if (!isFundNote(info.code, info.hasFundTag) || !info.code) continue;
		if (seen.has(info.code)) continue;
		seen.add(info.code);
		codes.push(info.code);

		// 本来就没记录的直接跳过；有记录但加载失败的收进失败清单供汇总视图点名
		const result = await loadFundAnalysisResult(app, file, info.code);
		if (result.status !== 'ok') {
			if (result.status === 'failed') failedFunds.push(result.failure);
			continue;
		}
		const data = result.data;

		const { navHistory, resolved, summary: s } = data;
		const lastNav = navHistory[navHistory.length - 1];
		allFlows.push(...buildCashFlows(resolved, s.holdShares, s.holdAmount, s.navDate));

		// 顺带收集窗口内买卖记录：仅 buy/sell，分红不计入操作列表
		for (const tx of resolved) {
			if (tx.type !== 'buy' && tx.type !== 'sell') continue;
			if (tx.date < since || tx.date > today) continue;
			recentTrades.push({
				kind: 'fund',
				type: tx.type,
				date: tx.date,
				code: info.code,
				name: data.name,
				filePath: file.path,
				amount: tx.amount,
				shares: tx.shares,
				fee: tx.fee,
				note: tx.note,
				nav: tx.nav,
				pending: tx.pending,
				// 持有金额（持仓市值）复用本循环已算好的汇总，零额外开销
				holdValue: s.holdAmount,
			});
		}

		const holdingCost = s.avgCostPerShare;
		const cumulativeCost = s.holdShares > 0 ? s.totalInvested / s.holdShares : null;

		pending.push({
			card: {
				code: info.code,
				name: data.name,
				filePath: file.path,
				holdAmount: s.holdAmount,
				totalInvested: s.totalInvested,
				totalProfit: s.totalProfit,
				totalProfitRate: s.totalProfitRate,
				todayProfit: s.todayProfit,
				holdDays: s.holdDays,
				annual:
					calcAnnualRate(resolved, s.holdShares, s.holdAmount, s.navDate) ??
					(s.holdDays >= 365
						? Math.pow(1 + s.totalProfitRate, 365 / s.holdDays) - 1
						: s.totalProfitRate),
				todayChange: s.todayChange,
				navDate: lastNav ? lastNav.date : null,
				sparkline: navHistory.map((r) => r.netWorth).slice(-24),
				skipTradeNotify: data.skipTradeNotify,
			},
			navHistory,
			holdShares: s.holdShares,
			holdingCost,
			cumulativeCost,
			config: { ...DEFAULT_CHANNEL_CONFIG, ...configs[info.code] },
		});
	}

	// 统一拉取一次当日估值，再据此计算每只基金的买卖信号（无当日估值时回退昨日净值）
	const estimates = await fetchRealtimeEstimates(codes);
	const cards: FundCard[] = [];
	for (const p of pending) {
		const estNav = todayEstimateNav(estimates, p.card.code)?.nav ?? null;
		const signal =
			computeSignals && p.holdShares > 0 && p.holdingCost > 0
				? computeTrendChannelSignal(
						p.navHistory,
						{ holdingCost: p.holdingCost, cumulativeCost: p.cumulativeCost },
						p.config,
						estNav,
					)
				: null;
		cards.push({ ...p.card, signal });
	}
	failedFunds.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
	return { cards, estimates, annualized: xirr(allFlows), recentTrades, failedFunds };
}

/**
 * 由已汇总的基金卡片求和，得到顶部"汇总卡片"的数据。annualizedXirr 为全组合 XIRR 年化（null 则回退旧口径）。
 * `todayProfitDate` 为各基金最新净值日中**最早**的一个（净值口径的行情日期）；盘中估值有效时由调用方覆盖为当日。
 */
export function summarizeFundCards(
	cards: FundCard[],
	annualizedXirr: number | null = null,
): PortfolioOverview {
	let totalAssets = 0;
	let totalProfit = 0;
	let totalInvested = 0;
	let totalHoldDays = 0;
	let todayProfit = 0;
	let navDate = '';

	for (const c of cards) {
		totalAssets += c.holdAmount;
		totalProfit += c.totalProfit;
		totalInvested += c.totalInvested;
		totalHoldDays += c.holdDays;
		todayProfit += c.todayProfit;
		if (c.navDate && (navDate === '' || c.navDate < navDate)) navDate = c.navDate;
	}

	const profitRate = totalInvested > 0 ? totalProfit / totalInvested : 0;
	const avgHoldDays = cards.length > 0 ? totalHoldDays / cards.length : 0;
	const annualized =
		annualizedXirr ??
		(avgHoldDays >= 365 ? Math.pow(1 + profitRate, 365 / avgHoldDays) - 1 : profitRate);

	return {
		totalAssets,
		totalProfit,
		totalInvested,
		annualized,
		fundCount: cards.length,
		fundAssets: totalAssets,
		stockCount: 0,
		stockAssets: 0,
		stockProfit: 0,
		unpricedStockCount: 0,
		todayProfit,
		todayProfitDate: navDate,
	};
}

/**
 * 把股票持仓的市值与累计收益并入组合总览。
 * 只改写总资产 / 累计收益与股票相关字段：`fundAssets` 保持基金口径（今日涨跌幅分母）、
 * `annualized` 与 `todayProfit` 保持基金口径，由 UI 注明口径差异。
 * 行情不可用的股票已在 `stock` 中排除并记入 `unpricedCount`，此处不再单独处理。
 */
export function applyStockPortfolio(overview: PortfolioOverview, stock: StockPortfolio): void {
	overview.stockCount = stock.stockCount;
	overview.stockAssets = stock.assets;
	overview.stockProfit = stock.profit;
	overview.unpricedStockCount = stock.unpricedCount;
	overview.totalAssets += stock.assets;
	overview.totalProfit += stock.profit;
}

/** 今日盈亏（估值口径）：仅当日估值有效，持有金额 × 估算涨跌幅 / 100；无效时返回 null 以回退官方净值口径 */
export function sumEstimatedTodayProfit(
	cards: FundCard[],
	estimates: Map<string, RealtimeEstimate>,
): number | null {
	const today = todayKey();
	let total = 0;
	let valid = false;
	for (const card of cards) {
		const est = estimates.get(card.code);
		if (!est || est.date !== today) continue;
		total += (card.holdAmount * est.gszzl) / 100;
		valid = true;
	}
	return valid ? total : null;
}