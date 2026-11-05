import type { FrontMatterCache } from 'obsidian';

export const TAG = 'fund-investment';
export const STOCK_TAG = 'stock-investment';

/** 归一化 frontmatter tags：可以是字符串或数组 */
function normalizeTags(tags: unknown): string[] {
	if (Array.isArray(tags)) return tags.map((t) => String(t));
	if (typeof tags === 'string') return tags.includes(',')
		? tags.split(',').map((t) => t.trim()).filter(Boolean)
		: [tags];
	return [];
}

export interface FundNoteInfo {
	code: string | null;
	hasFundTag: boolean;
}

/** 基金代码统一为 6 位；YAML 数字会丢失前导 0（如 020274→20274），据此补齐 */
function padCode(code: string): string {
	const digits = code.replace(/\D/g, '');
	return digits.length > 0 ? digits.padStart(6, '0') : '';
}

/** 从文件的 frontmatter 读取基金代码与基金标签标记 */
export function readFundNoteInfo(frontmatter?: FrontMatterCache | null): FundNoteInfo {
	if (!frontmatter) return { code: null, hasFundTag: false };
	const raw: unknown = (frontmatter as Record<string, unknown>)['fund_code'] ?? (frontmatter as Record<string, unknown>)['fundCode'];
	const code = typeof raw === 'string' || typeof raw === 'number' ? padCode(String(raw)) : '';
	const tags = normalizeTags(frontmatter.tags);
	return { code: code || null, hasFundTag: tags.includes(TAG) };
}

/** 判断文件是否命中基金笔记的自动展示条件 */
export function isFundNote(code: string | null, hasFundTag: boolean): boolean {
	return Boolean(code && hasFundTag);
}

export interface StockNoteInfo {
	code: string | null;
	hasStockTag: boolean;
}

/** 从文件的 frontmatter 读取股票代码与股票标签标记；股票代码不做补位（支持 600519 / sh600519 等） */
export function readStockNoteInfo(frontmatter?: FrontMatterCache | null): StockNoteInfo {
	if (!frontmatter) return { code: null, hasStockTag: false };
	const raw: unknown =
		(frontmatter as Record<string, unknown>)['stock_code'] ??
		(frontmatter as Record<string, unknown>)['stockCode'];
	const code = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
	const tags = normalizeTags(frontmatter.tags);
	return { code: code || null, hasStockTag: tags.includes(STOCK_TAG) };
}

/** 判断文件是否命中股票笔记的展示条件 */
export function isStockNote(code: string | null, hasStockTag: boolean): boolean {
	return Boolean(code && hasStockTag);
}