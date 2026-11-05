import { type App, TFile } from 'obsidian';
import { STOCK_RECORD_BLOCK_LANG, type RecordParse } from '../types';
import { getFirstRecordBlock, parseRecordSource } from '../utils/recordParser';
import { loadFundAnalysis } from './fundAnalysis';
import type { PositionTarget } from './positionTargets';

/** 股票持仓股数：买入累加、卖出扣减，负数钳为 0（与记录块汇总同口径） */
export function sumStockHoldShares(entries: RecordParse['entries']): number {
	let holdShares = 0;
	for (const { tx } of entries) {
		if (tx.type === 'buy' && tx.shares > 0) holdShares += tx.shares;
		else if (tx.type === 'sell' && tx.shares > 0) holdShares -= tx.shares;
	}
	return Math.max(0, holdShares);
}

/**
 * 卖出可卖份额：股票按记录块买卖推导；基金走指标分析链路（含净值补全）。
 * 无记录块、读取失败或净值不可得时返回 null，由调用方决定不拦截。
 */
export async function resolveAvailableShares(
	app: App,
	target: PositionTarget,
): Promise<number | null> {
	try {
		const file = app.vault.getAbstractFileByPath(target.filePath);
		if (!(file instanceof TFile)) return null;
		if (target.kind === 'stock') {
			const content = await app.vault.cachedRead(file);
			const block = getFirstRecordBlock(content, STOCK_RECORD_BLOCK_LANG);
			if (!block) return null;
			const parsed = parseRecordSource(block.inner);
			return parsed.entries.length > 0 ? sumStockHoldShares(parsed.entries) : null;
		}
		const data = await loadFundAnalysis(app, file, target.code);
		return data ? data.summary.holdShares : null;
	} catch {
		return null;
	}
}
