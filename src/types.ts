export type TxType = 'buy' | 'sell' | 'dividend';

/** 基金 record 代码块语言标识 */
export const RECORD_BLOCK_LANG = 'fund-record';

/** 股票 record 代码块语言标识 */
export const STOCK_RECORD_BLOCK_LANG = 'stock-record';

/** 一条交易记录（record 代码块中的一行 CSV） */
export interface Transaction {
	type: TxType;
	/** 交易日期 YYYY-MM-DD */
	date: string;
	/** 金额（元）：买入=投入金额；卖出=卖出金额（可由份额×净值补全） */
	amount: number;
	/** 份额：卖出必填；买入可由金额÷净值补全 */
	shares: number;
	/** 手续费（元） */
	fee: number;
	/** 备注（不含逗号） */
	note: string;
}

/** 待净值解析结果 */
export interface ResolvedTransaction extends Transaction {
	/** share/amount 缺失时，按日期净值推导出的值 */
	nav: number | null;
	/** 是否处于"待确认"状态（缺乏净值无法补全） */
	pending: boolean;
}

export interface NetWorthRecord {
	date: string;
	netWorth: number;
	/** 日增长率（%） */
	netWorthChange: number;
}

/** 单基金持仓收益汇总 */
export interface HoldingSummary {
	holdShares: number;
	/** 累计投入 = Σ买入金额 − Σ卖出金额 */
	totalInvested: number;
	/** 持仓市值 = 持有份额 × 最新净值 */
	holdAmount: number;
	/** 总收益 = 持仓市值 − 累计投入 + 分红 */
	totalProfit: number;
	/** 累计分红（元） */
	totalDividend: number;
	/** 总收益率（小数）= 总收益 / 累计买入成本 */
	totalProfitRate: number;
	/** 今日涨跌幅（小数） */
	todayChange: number;
	/** 今日盈亏（元） */
	todayProfit: number;
	/** 加权平均持仓成本（元/份） */
	avgCostPerShare: number;
	/** 至今浮盈（未实现）= 市值 − 加权成本 × 持有份额 */
	holdingProfit: number;
	/** 持仓收益率（小数） */
	holdingProfitRate: number;
	/** 最新单位净值 */
	latestNav: number;
	/** 净值日期 */
	navDate: string;
	/** 是否拿到可用净值；为 false 时市值与收益类指标不可用，不应按 0 净值汇总 */
	navAvailable: boolean;
	/** 持有天数 */
	holdDays: number;
}

/** 疑似交易记录但解析失败的原因（仅用于提示文案） */
export type RecordLineError = 'columns' | 'type' | 'date' | 'layout';

/** 疑似交易记录但解析失败的一行 */
export interface UnparsedRecordLine {
	/** 块内行号（0 基，与 entries 的 lineIdx 同基准；展示时 +1） */
	lineIdx: number;
	reason: RecordLineError;
}

/** record 代码块解析结果：当前行（含注释/空行）与其中的记录行 */
export interface RecordParse {
	/** 代码块原始行（含注释/空行，用于编辑与回写） */
	lines: string[];
	/** 有效交易记录；lineIdx 指向 lines 中该多条记录的起始行 */
	entries: { tx: Transaction; lineIdx: number }[];
	/** 疑似记录但被丢弃的行（不含空行与注释行），仅用于提示，不参与计算 */
	unparsed: UnparsedRecordLine[];
}