import type { App } from 'obsidian';
import { STOCK_RECORD_BLOCK_LANG, type RecordParse } from '../types';
import { isStockNote, readStockNoteInfo } from '../utils/frontmatter';
import { getFirstRecordBlock, parseRecordSource } from '../utils/recordParser';
import { firstHeading } from './fundAnalysis';
import { sumStockHoldShares } from './positionHolding';
import { fetchStockQuote, type StockQuote } from './stockSdk';

export interface StockHoldingSummary {
	holdShares: number;
	/** 加权平均买入成本（元/股，含买入手续费） */
	avgCostPerShare: number;
	/** 成本基准 = 均价 × 持仓数量（仅剩余持仓，含买入手续费） */
	costBasis: number;
	/** 持仓市值 = 持仓数量 × 最新价 */
	holdAmount: number;
	/** 持仓盈亏 = 市值 − 成本基准（仅剩余持仓，不含已卖出部分） */
	holdingProfit: number;
	/** 持仓盈亏率（小数） */
	holdingProfitRate: number;
	/** 累计买入金额（含手续费，含已卖出部分对应的成本） */
	totalBuyCost: number;
	/** 累计卖出回款（已扣手续费） */
	totalSellAmount: number;
	/** 累计分红（已扣手续费） */
	totalDividend: number;
	/** 总收益 = 市值 − 净投入（买入 − 卖出）+ 分红，全部扣减手续费，含已兑现的卖出收益 */
	totalProfit: number;
	/** 总收益率 = 总收益 ÷ 累计买入金额（与基金侧同口径） */
	totalProfitRate: number;
}

/**
 * 汇总股票记录块的两套口径：
 * - **持仓口径**（持仓盈亏）= 剩余持仓市值 − 剩余持仓成本基准，只反映尚未卖出的部分；
 * - **总口径**（总收益）= 市值 − 净投入 + 分红，把已卖出部分的回款一并累计进来，与基金侧 `summarizeHolding` 一致。
 * 两套口径的分母也不同：持仓盈亏率用成本基准，总收益率用累计买入金额——净投入做分母时，
 * 卖出回款已体现在收益金额里，减仓后收益率会虚高、清仓时分母归零。
 * 手续费按实际资金流处理：买入计入成本，卖出与分红冲减回款。
 */
export function summarizeStockHolding(
	entries: RecordParse['entries'],
	quote: StockQuote | null,
): StockHoldingSummary {
	let totalBuyCost = 0;
	let totalBuyShares = 0;
	let totalSellAmount = 0;
	let totalDividend = 0;
	for (const { tx } of entries) {
		const fee = tx.fee || 0;
		if (tx.type === 'buy' && tx.shares > 0) {
			// 买入手续费计入成本
			totalBuyCost += tx.amount + fee;
			totalBuyShares += tx.shares;
		} else if (tx.type === 'sell' && tx.shares > 0) {
			// 卖出手续费冲减回款
			totalSellAmount += tx.amount - fee;
		} else if (tx.type === 'dividend') {
			// 分红手续费冲减到账金额
			totalDividend += tx.amount - fee;
		}
	}
	const holdShares = sumStockHoldShares(entries);
	const avgCostPerShare = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;
	const costBasis = avgCostPerShare * holdShares;
	const holdAmount = holdShares * (quote?.price ?? 0);
	const holdingProfit = holdAmount - costBasis;
	const holdingProfitRate = costBasis > 0 ? holdingProfit / costBasis : 0;
	const totalProfit = holdAmount - (totalBuyCost - totalSellAmount) + totalDividend;
	const totalProfitRate = totalBuyCost > 0 ? totalProfit / totalBuyCost : 0;
	return {
		holdShares,
		avgCostPerShare,
		costBasis,
		holdAmount,
		holdingProfit,
		holdingProfitRate,
		totalBuyCost,
		totalSellAmount,
		totalDividend,
		totalProfit,
		totalProfitRate,
	};
}

/** 侧栏列表里的单只股票卡片（对齐基金卡片字段） */
export interface StockCard {
	code: string;
	name: string;
	filePath: string;
	holdShares: number;
	/** 持仓市值 = 持仓数量 × 最新价 */
	holdAmount: number;
	/** 累计收益 = 市值 − 净投入 + 分红 */
	totalProfit: number;
	totalProfitRate: number;
	/** 最新价；已清仓或行情不可用时为 null */
	price: number | null;
	/** 涨跌幅（%）；已清仓或行情不可用时为 null */
	changePercent: number | null;
}

/** 全库股票持仓的汇总（并入组合总览用） */
export interface StockPortfolio {
	/** 有有效记录并纳入汇总的股票数（含已清仓） */
	stockCount: number;
	/** 持仓市值合计（元） */
	assets: number;
	/** 累计收益合计（元）= 市值 − 净投入 + 分红，含已卖出回款 */
	profit: number;
	/** 有持仓但行情不可用、未纳入统计的股票数 */
	unpricedCount: number;
	/** 纳入汇总的股票卡片（含已清仓；按持仓市值降序） */
	cards: StockCard[];
}

/**
 * 扫描全部股票笔记，汇总持仓市值与累计收益。
 *
 * 记录解析为纯本地（`cachedRead` + 首个 `stock-record` 块），与 `collectStockRecentTrades`
 * 采用同一套笔记识别与去重规则（frontmatter `stock_code` + `stock-investment`、同代码只取首篇）。
 * 持仓数量 > 0 时经 `fetchStockQuote`（60s 缓存）取最新价，行情不可得的股票不计入资产与收益，
 * 只累加 `unpricedCount` 供 UI 点名——避免按 0 价计入造成假亏损。
 * 已清仓（数量为 0）的股票不再请求行情，但仍累计已兑现的买卖收益与分红。
 * 单文件读取/解析异常被吞掉并跳过，不中断整体扫描。
 */
export async function collectStockPortfolio(app: App): Promise<StockPortfolio> {
	const pending: {
		code: string;
		name: string;
		filePath: string;
		entries: RecordParse['entries'];
		holdShares: number;
	}[] = [];
	const seen = new Set<string>();

	for (const file of app.vault.getMarkdownFiles()) {
		const info = readStockNoteInfo(app.metadataCache.getFileCache(file)?.frontmatter);
		if (!isStockNote(info.code, info.hasStockTag) || !info.code) continue;
		if (seen.has(info.code)) continue;
		seen.add(info.code);

		try {
			const content = await app.vault.cachedRead(file);
			const block = getFirstRecordBlock(content, STOCK_RECORD_BLOCK_LANG);
			if (!block) continue;
			const parsed = parseRecordSource(block.inner);
			if (parsed.entries.length === 0) continue;
			pending.push({
				code: info.code,
				name: firstHeading(content, info.code),
				filePath: file.path,
				entries: parsed.entries,
				holdShares: sumStockHoldShares(parsed.entries),
			});
		} catch {
			// 单文件失败不影响其它笔记
			continue;
		}
	}

	// 有持仓的股票并行取价（走 60s 缓存）；已清仓的不再请求行情
	const priced = await Promise.all(
		pending.map(async (p) => ({
			p,
			quote: p.holdShares > 0 ? await fetchStockQuote(p.code) : null,
		})),
	);

	let assets = 0;
	let profit = 0;
	let unpricedCount = 0;
	const cards: StockCard[] = [];
	for (const { p, quote } of priced) {
		if (p.holdShares > 0 && quote === null) {
			unpricedCount++;
			continue;
		}
		const summary = summarizeStockHolding(p.entries, quote);
		assets += summary.holdAmount;
		profit += summary.totalProfit;
		cards.push({
			code: p.code,
			name: p.name,
			filePath: p.filePath,
			holdShares: summary.holdShares,
			holdAmount: summary.holdAmount,
			totalProfit: summary.totalProfit,
			totalProfitRate: summary.totalProfitRate,
			price: quote?.price ?? null,
			changePercent: quote?.changePercent ?? null,
		});
	}

	cards.sort((a, b) => b.holdAmount - a.holdAmount);
	return { stockCount: cards.length, assets, profit, unpricedCount, cards };
}
