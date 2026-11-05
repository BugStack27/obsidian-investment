import type { App } from 'obsidian';
import { STOCK_RECORD_BLOCK_LANG, type RecordParse } from '../types';
import { isStockNote, readStockNoteInfo } from '../utils/frontmatter';
import { getFirstRecordBlock, parseRecordSource } from '../utils/recordParser';
import { firstHeading } from './fundAnalysis';
import { sumStockHoldShares } from './positionHolding';
import { todayKey } from './signalAlerts';
import { fetchStockQuote } from './stockSdk';
import type { TodayTrade } from './todayTrades';

/**
 * 快照统一保留的最大窗口（自然日）：基金与股票侧都按此范围收集，
 * 弹窗内的 7 / 30 天窗口从同一份数据裁剪，切换时不重新扫库。
 */
export const RECENT_TRADE_DAYS = 90;

/** 以本地日期做加减，返回 YYYY-MM-DD（走 `Date` 运算，跨月/跨年自动进位） */
export function shiftDateKey(key: string, days: number): string {
	const [year, month, day] = key.split('-');
	const dt = new Date(Number(year), Number(month) - 1, Number(day));
	dt.setDate(dt.getDate() + days);
	return todayKey(dt);
}

/**
 * 近期操作排序：**日期倒序**；同日「买入先于卖出」，再按来源（基金在股票之前）、
 * 名称（中文）升序兜底。记录只有日期没有日内时间，故同日不保证实际成交先后。返回新数组。
 */
export function sortRecentTrades(list: TodayTrade[]): TodayTrade[] {
	return [...list].sort((a, b) => {
		if (a.date !== b.date) return a.date < b.date ? 1 : -1;
		if (a.type !== b.type) return a.type === 'buy' ? -1 : 1;
		if (a.kind !== b.kind) return a.kind === 'fund' ? -1 : 1;
		return a.name.localeCompare(b.name, 'zh');
	});
}

/** 一个日期分组（弹窗按日平铺） */
export interface RecentTradeGroup {
	/** YYYY-MM-DD */
	date: string;
	trades: TodayTrade[];
}

/**
 * 按「近 `days` 天」窗口裁剪并分组：窗口 = `[today-(days-1), today]`，含今天、**不含未来日期**。
 * 日期倒序；组内顺序同 `sortRecentTrades`。空日期不产出组。
 */
export function groupRecentTrades(
	list: TodayTrade[],
	days: number,
	today = todayKey(),
): RecentTradeGroup[] {
	const since = shiftDateKey(today, -(days - 1));
	const sorted = sortRecentTrades(list.filter((t) => t.date >= since && t.date <= today));
	const groups: RecentTradeGroup[] = [];
	const byDate = new Map<string, RecentTradeGroup>();
	for (const t of sorted) {
		let group = byDate.get(t.date);
		if (!group) {
			group = { date: t.date, trades: [] };
			byDate.set(t.date, group);
			groups.push(group);
		}
		group.trades.push(t);
	}
	return groups;
}

/**
 * 扫描全部股票笔记，收集其中**近 `since ~ today`** 的买入/卖出记录。
 *
 * 记录解析为纯本地：走 `cachedRead` + 记录块解析，股票名取笔记一级标题（不回退到行情接口）。
 * **行情请求**仅为「今日确有买卖记录」的代码各发生一次（`fetchStockQuote`，60s 缓存），
 * 用于今日档的持有金额排序；非今日条目的 `holdValue` 恒为 `null`（近期列表不展示该列）。
 * 每个笔记只取首个 `stock-record` 块（与 `stockRecordBlock`、`transformRecordBlock` 语义一致）；
 * 同一股票代码只取首个笔记。单文件读取/解析异常被吞掉并跳过，不中断整体扫描。
 */
export async function collectStockRecentTrades(
	app: App,
	opts: { since: string; today?: string },
): Promise<TodayTrade[]> {
	const today = opts.today ?? todayKey();
	const out: TodayTrade[] = [];
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

			// 先判有无窗口内记录：无则整条链路（含行情请求）都不发生
			const recent = parsed.entries.filter(
				({ tx }) =>
					(tx.type === 'buy' || tx.type === 'sell') &&
					tx.date >= opts.since &&
					tx.date <= today,
			);
			if (recent.length === 0) continue;

			const hasToday = recent.some(({ tx }) => tx.date === today);
			const holdValue = hasToday ? await stockHoldValue(info.code, parsed.entries) : null;
			const name = firstHeading(content, info.code);

			for (const { tx } of recent) {
				if (tx.type !== 'buy' && tx.type !== 'sell') continue;
				out.push({
					kind: 'stock',
					type: tx.type,
					date: tx.date,
					code: info.code,
					name,
					filePath: file.path,
					amount: tx.amount,
					shares: tx.shares,
					fee: tx.fee,
					note: tx.note,
					nav: null,
					pending: false,
					// 仅今日条目需要持有金额（今日档排序）；其余条目恒为 null
					holdValue: tx.date === today ? holdValue : null,
				});
			}
		} catch {
			// 单文件失败不影响其它笔记
			continue;
		}
	}
	return out;
}

/**
 * 股票当前持有金额（持仓市值）= 持仓数量 × 最新价。
 * 持仓数量由记录块**全量** buy/sell 推导（与 `stockRecordBlock.summarizeStockHolding` 同口径）；
 * 最新价走 `fetchStockQuote`（60s 缓存，失败返回 null）→ 行情不可得时返回 null。
 * 已清仓返回 0（不再请求行情）。
 */
async function stockHoldValue(code: string, entries: RecordParse['entries']): Promise<number | null> {
	const holdShares = sumStockHoldShares(entries);
	if (holdShares <= 0) return 0;
	const quote = await fetchStockQuote(code);
	return quote ? holdShares * quote.price : null;
}
