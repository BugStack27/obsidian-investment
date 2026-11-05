import type { App } from 'obsidian';
import type InvestmentPlugin from '../main';
import type { FundLoadFailure } from '../services/fundAnalysis';
import { EstimateTodayMonitor } from '../services/estimateTodayMonitor';
import {
    EMPTY_OVERVIEW,
    applyStockPortfolio,
    buildFundCards,
    sumEstimatedTodayProfit,
    summarizeFundCards,
    type FundCard,
    type PortfolioOverview,
} from '../services/portfolioOverview';
import { fetchRealtimeEstimates, type RealtimeEstimate } from '../services/realtimeEstimate';
import {
    RECENT_TRADE_DAYS,
    collectStockRecentTrades,
    shiftDateKey,
    sortRecentTrades,
} from '../services/recentTrades';
import { todayKey, type SignalItem, type SignalStatus } from '../services/signalAlerts';
import { fetchFundNavHistory } from '../services/stockSdk';
import { collectStockPortfolio, type StockCard } from '../services/stockPortfolio';
import { type TodayTrade } from '../services/todayTrades';
import { isTradingDayToday, isTradingSession, isWeekdayTradingFallback } from '../services/tradingCalendar';
import { type SignalStatusRecord } from '../settings';

/** 数据变更类型：full=全量重建，estimate=盘中估值刷新，status=信号处理状态变更 */
export type StoreChange = 'full' | 'estimate' | 'status';

/** 对外不可变快照 */
export interface StoreSnapshot {
	change: StoreChange;
	cards: FundCard[];
	overview: PortfolioOverview;
	signals: SignalItem[];
	estimates: Map<string, RealtimeEstimate>;
	/**
	 * 今日是否 A 股交易日（`tradingCalendar.isTradingDayToday`）。
	 * 非交易日：买卖信号不计算（`signals` 为空、卡片 `signal` 为 null）、不提醒、不轮询盘中估值。
	 */
	tradingDay: boolean;
	/**
	 * 近 `RECENT_TRADE_DAYS` 天（**自然日**，含今天、不含未来日期）全部买入/卖出记录，
	 * 基金与股票合并并按「日期倒序 → 同日买入先 → 基金先 → 名称」排序；分红不计入。
	 * 供「近期操作」弹窗按 7/30/90 天窗口本地裁剪，仅随全量刷新重建；
	 * 今日档由弹窗按 `date === today` 派生并按持有金额降序。
	 */
	recentTrades: TodayTrade[];
	/**
	 * 股票持仓卡片（含已清仓，按市值降序），与 `cards` 一起构成侧栏「投资汇总」列表。
	 * 行情不可用的股票不计入（由 `overview.unpricedStockCount` 点名）。
	 */
	stocks: StockCard[];
	/**
	 * 有有效记录但加载失败、未纳入汇总的基金（按名称升序）。
	 * 仅随全量刷新重算；盘中估值刷新沿用上一轮清单。
	 */
	failedFunds: FundLoadFailure[];
	error?: string;
}

/**
 * 投资数据中枢：统一管理所有底层数据（净值/估值/持仓卡片/汇总/信号）并对外缓存。
 * - 单一计算管线：每次全量刷新只扫描一次代码块、计算一次卡片/汇总/信号；
 * - 统一缓存：净值走 stockSdk 缓存、估值走 realtimeEstimate 60s 缓存，本轮轻量估值刷新不改写卡片；
 * - 响应式订阅：`subscribe` 收到不可变快照，各视图按 change 类型增量更新；
 * - 今日盈亏输出位经 `today` 监控统一写入，避免各视图重复实现。
 */
export class InvestmentDataStore {
	private readonly app: App;
	private readonly plugin: InvestmentPlugin;
	private readonly listeners = new Set<(s: StoreSnapshot) => void>();
	private readonly today = new EstimateTodayMonitor();
	private seq = 0;
	private lastFullAt = 0;
	private state: StoreSnapshot = {
		change: 'full',
		cards: [],
		overview: EMPTY_OVERVIEW,
		signals: [],
		estimates: new Map(),
		// 交易日尚未判定：先用「周一至周五」保守初值，refresh 后以交易日历结果覆盖
		tradingDay: isWeekdayTradingFallback(),
		recentTrades: [],
		failedFunds: [],
		stocks: [],
	};

	constructor(plugin: InvestmentPlugin) {
		this.app = plugin.app;
		this.plugin = plugin;
	}

	/** 付费输出位的明确入口（供状态栏/侧栏注册"今日"金额/涨跌幅元素） */
	get todayMonitor(): EstimateTodayMonitor {
		return this.today;
	}

	get snapshot(): StoreSnapshot {
		return this.state;
	}

	subscribe(fn: (s: StoreSnapshot) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	/**
	 * 全量重建：判定交易日 → 扫描基金笔记 → 计算卡片/汇总/信号 → 拉取盘中估值 → 合并操作记录。
	 * 基金侧记录由 `buildFundCards` 顺带产出（复用其已加载的记录）；股票侧另扫一遍股票笔记
	 * （记录解析纯本地；仅为含今日记录的股票各取一次行情，用于今日档的持有金额排序）。
	 * 股票持仓与行情由 `collectStockPortfolio` 并行汇总，卡片随快照下发供侧栏列表展示。
	 * 近 `RECENT_TRADE_DAYS` 天的记录写入 `recentTrades`，今日档由弹窗从其中按需派生。
	 */
	async refresh(): Promise<void> {
		const seq = ++this.seq;
		try {
			// 交易日判定走每日缓存：当天仅首次刷新产生一次请求，跨天自动失效
			const tradingDay = await isTradingDayToday();
			const today = todayKey();
			const since = shiftDateKey(today, -(RECENT_TRADE_DAYS - 1));
			const { cards, estimates, annualized, recentTrades: fundTrades, failedFunds } = await buildFundCards(
				this.app,
				this.plugin.settings.trendChannelConfig,
				{ computeSignals: tradingDay },
			);
			// 股票笔记不在基金卡片链路内，单独轻量扫描（行情仅取今日有记录的代码，60s 缓存）
			const [stockTrades, stockPortfolio] = await Promise.all([
				collectStockRecentTrades(this.app, { since, today }),
				collectStockPortfolio(this.app),
			]);
			const recentTrades = sortRecentTrades([...fundTrades, ...stockTrades]);
			const overview = summarizeFundCards(cards, annualized);
			// 股票市值与累计收益并入总览；年化与今日盈亏保持基金口径
			applyStockPortfolio(overview, stockPortfolio);
			// 今日盈亏按估值口径；估值无效时保持官方净值口径（连同其行情日期）
			applyEstimatedTodayProfit(overview, sumEstimatedTodayProfit(cards, estimates));
			const signals = toSignalItems(cards);
			if (seq !== this.seq) return;
			this.today.setCards(cards);
			this.today.render(estimates);
			this.emit({
				change: 'full',
				cards,
				overview,
				signals,
				estimates,
				tradingDay,
				recentTrades,
				failedFunds,
				stocks: stockPortfolio.cards,
			});
		} catch (e) {
			if (seq !== this.seq) return;
			this.emit({
				change: 'full',
				cards: this.state.cards,
				overview: this.state.overview,
				signals: this.state.signals,
				estimates: this.state.estimates,
				tradingDay: this.state.tradingDay,
				recentTrades: this.state.recentTrades,
				failedFunds: this.state.failedFunds,
				stocks: this.state.stocks,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	/** 交易时段轻量估值刷新：仅更新估值与"今日"，不改写卡片与操作记录；非交易日不轮询 */
	async refreshEstimates(): Promise<void> {
		if (!isTradingSession() || this.state.cards.length === 0) return;
		if (!(await isTradingDayToday())) return;
		const estimates = await fetchRealtimeEstimates(this.state.cards.map((c) => c.code));
		const overview = { ...this.state.overview };
		applyEstimatedTodayProfit(overview, sumEstimatedTodayProfit(this.state.cards, estimates));
		this.today.render(estimates);
		this.emit({
			change: 'estimate',
			cards: this.state.cards,
			overview,
			signals: this.state.signals,
			estimates,
			tradingDay: this.state.tradingDay,
			recentTrades: this.state.recentTrades,
			failedFunds: this.state.failedFunds,
			stocks: this.state.stocks,
		});
	}

	/**
	 * 定时驱动：交易时段每 tick 走轻量估值刷新；距上次全量超过一小时则补一次全量。
	 * 由插件以 ~60s 间隔调用。
	 */
	tick(): void {
		const now = Date.now();
		void this.refreshEstimates();
		if (now - this.lastFullAt >= 60 * 60 * 1000) {
			this.lastFullAt = now;
			void this.refresh();
		}
	}

	/** 统一缓存：某基金净值历史（可达 stockSdk 缓存） */
	nav(code: string) {
		return fetchFundNavHistory(code);
	}

	/** 查询某只基金当天信号的确认/忽略状态（无记录或记录日期非今日返回 null） */
	getSignalStatus(code: string): SignalStatus | null {
		const rec = this.plugin.settings.signalStatusRecord;
		if (!rec || rec.recordDate !== todayKey()) return null;
		const s = rec[code];
		return s === 'confirmed' || s === 'ignored' ? s : null;
	}

	/** 标记某只基金信号的确认/忽略；记录日期与今日不一致时先清空失效记录，再写当日状态 */
	markSignal(code: string, status: SignalStatus): void {
		const today = todayKey();
		const cur = this.plugin.settings.signalStatusRecord;
		const next: SignalStatusRecord =
			cur && cur.recordDate === today ? { ...cur } : { recordDate: today };
		next[code] = status;
		this.plugin.settings.signalStatusRecord = next;
		void this.plugin.saveSettings().then(() => {
			this.emit({ ...this.state, change: 'status' });
		});
	}

	private emit(s: StoreSnapshot): void {
		this.state = s;
		for (const fn of this.listeners) fn(s);
	}
}

/**
 * 由基金卡片派生信号条目；设置了 skipTradeNotify 的基金不参与提醒（信号仍随卡片计算，供图表与通道分析使用）。
 * 非交易日卡片不含信号，故派生结果为空数组 —— 提醒链路天然静默。
 */
function toSignalItems(cards: FundCard[]): SignalItem[] {
	const items = cards
		.filter((c) => c.signal && !c.skipTradeNotify)
		.map((c) => ({ ...c.signal!, code: c.code, name: c.name, filePath: c.filePath }));
	items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
	return items;
}

/**
 * 估值口径覆盖：估值有效时把今日盈亏连同其行情日期（当日）写入汇总。
 * 估值无效（非交易日 / 盘前，接口仍返回上一交易日数据）时不改动 —— 汇总保持
 * `summarizeFundCards` 的净值口径数值与净值日期，UI 据此显示如「09-18 +¥495.32」而非误标「今日」。
 */
function applyEstimatedTodayProfit(overview: PortfolioOverview, estToday: number | null): void {
	if (estToday === null) return;
	overview.todayProfit = estToday;
	overview.todayProfitDate = todayKey();
}