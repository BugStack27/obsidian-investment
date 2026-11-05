/** 交易条目来源笔记类型 */
export type TodayTradeKind = 'fund' | 'stock';

/**
 * 一条已录入的买入/卖出记录（近期操作弹窗及其今日档使用）。
 * 由基金侧（`buildFundCards` 顺带收集）与股票侧（`collectStockRecentTrades`）共同产出。
 */
export interface TodayTrade {
	kind: TodayTradeKind;
	/** 仅 buy/sell：分红不计入操作列表 */
	type: 'buy' | 'sell';
	/** 交易日期 YYYY-MM-DD；今日档只消费 `date === today` 的条目 */
	date: string;
	code: string;
	name: string;
	/** 记录所在笔记路径，供点击跳转 */
	filePath: string;
	amount: number;
	/** 基金=份额；股票=数量 */
	shares: number;
	fee: number;
	note: string;
	/** 基金按交易日期补全的参考净值；股票记录无净值概念，恒为 null */
	nav: number | null;
	/** 基金缺净值无法补全时为 true（列表显示「待确认」）；股票恒为 false */
	pending: boolean;
	/**
	 * 该标的当前**持有金额（持仓市值）**，同时是今日档的排序键。
	 * - 基金：`summarizeHolding` 的 `holdAmount`（份额 × 最新净值），恒为数值且无额外开销；
	 * - 股票：持仓数量 × 最新价；仅「今日有交易」时取一次行情，其余条目为 `null`（近期列表不展示该列）；
	 *   已清仓（持仓数量为 0）时为 `0`。
	 */
	holdValue: number | null;
}

function kindOrder(kind: TodayTradeKind): number {
	return kind === 'fund' ? 0 : 1;
}

/** 排序用持有金额：缺失（股票行情不可得）视为 -1，排在组内末尾 */
function sortHoldValue(t: TodayTrade): number {
	return t.holdValue ?? -1;
}

/**
 * 今日档排序：先买入组后卖出组（保留分组）；组内按**持有金额（持仓市值）降序**排列，
 * 即持仓越重的标的越靠前。持有金额相同时依次按来源（基金在股票之前）、名称（中文）升序兜底，
 * 保证顺序稳定。记录只有日期没有日内时间，故不做时间排序。返回新数组，不改动入参。
 */
export function sortTodayTrades(list: TodayTrade[]): TodayTrade[] {
	return [...list].sort((a, b) => {
		if (a.type !== b.type) return a.type === 'buy' ? -1 : 1;
		const ha = sortHoldValue(a);
		const hb = sortHoldValue(b);
		if (ha !== hb) return hb - ha;
		if (a.kind !== b.kind) return kindOrder(a.kind) - kindOrder(b.kind);
		return a.name.localeCompare(b.name, 'zh');
	});
}

/** 操作汇总（弹窗顶部汇总行用，今日/近期共用） */
export interface TodayTradeSummary {
	buyCount: number;
	buyAmount: number;
	sellCount: number;
	sellAmount: number;
}

export function summarizeTodayTrades(list: TodayTrade[]): TodayTradeSummary {
	const s: TodayTradeSummary = { buyCount: 0, buyAmount: 0, sellCount: 0, sellAmount: 0 };
	for (const t of list) {
		if (t.type === 'buy') {
			s.buyCount += 1;
			s.buyAmount += t.amount;
		} else {
			s.sellCount += 1;
			s.sellAmount += t.amount;
		}
	}
	return s;
}
