import type { Transaction } from '../types';
import { parse as parseCsvLine, stringify as stringifyCsv } from './csv';
import { normalizeRecordDate } from './recordDate';

export interface ImportResult {
	transactions: Transaction[];
	totalRows: number;
	invalidRows: number;
	skippedFundCode: number;
	warnings: string[];
}

/** 表头名称 → 规范字段（兼容中文与常见写法） */
const HEADER_ALIAS: Record<string, string> = {
	type: 'type', 方向: 'type',
	date: 'date', 日期: 'date',
	amount: 'amount', 金额: 'amount',
	shares: 'shares', 份额: 'shares',
	fee: 'fee', 手续费: 'fee',
	note: 'note', 备注: 'note',
	fundcode: 'fundCode', fund_code: 'fundCode', 基金代码: 'fundCode',
};

/** 无表头时的固定列顺序 */
const POSITIONAL_KEYS = ['type', 'date', 'amount', 'shares', 'fee', 'note'] as const;

/** 表头至少命中这么多个已知列名才判为表头，避免把数据行（如备注含「金额」）误判 */
const HEADER_MIN_HITS = 2;

function headerKey(cell: string): string | null {
	return HEADER_ALIAS[cell.trim().toLowerCase()] ?? null;
}

function looksLikeHeader(cells: string[]): boolean {
	const keys = new Set<string>();
	for (const c of cells) {
		const key = headerKey(c);
		if (key !== null) keys.add(key);
	}
	return keys.size >= HEADER_MIN_HITS;
}

function buildHeaderMap(cells: string[]): Record<string, number> | null {
	const map: Record<string, number> = {};
	for (let i = 0; i < cells.length; i++) {
		const key = headerKey(cells[i]!);
		if (key !== null && !(key in map)) map[key] = i;
	}
	return Object.keys(map).length > 0 ? map : null;
}

function num(v: string | undefined): number {
	if (v == null || v.trim() === '') return 0;
	const n = Number(v.trim().replace(/,/g, ''));
	return Number.isFinite(n) ? n : 0;
}

/** 解析批量导入的 CSV 文本，仅返回关键字段 */
export function parseImportCsv(text: string, expectedFundCode: string | null): ImportResult {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const result: ImportResult = {
		transactions: [],
		totalRows: 0,
		invalidRows: 0,
		skippedFundCode: 0,
		warnings: [],
	};

	let headerMap: Record<string, number> | null = null;

	for (const raw of lines) {
		const line = raw.trim();
		if (!line) continue;

		const cells = parseCsvLine(line).map((c) => c.trim());
		if (headerMap === null) {
			if (looksLikeHeader(cells)) {
				headerMap = buildHeaderMap(cells);
				continue;
			}
		}

		result.totalRows++;

		const get = (key: string): string => {
			if (headerMap) {
				const idx = headerMap[key];
				return idx != null ? (cells[idx] ?? '') : '';
			}
			const pos = POSITIONAL_KEYS.indexOf(key as (typeof POSITIONAL_KEYS)[number]);
			return pos >= 0 ? (cells[pos] ?? '') : '';
		};

		// 基金代码过滤：仅当本笔记有 fund_code 且导入行提供了不同的 fundCode 时跳过
		if (expectedFundCode && headerMap && headerMap.fundCode != null) {
			const fc = get('fundCode').replace(/\D/g, '').padStart(6, '0');
			if (fc && fc !== expectedFundCode.replace(/\D/g, '').padStart(6, '0')) {
				result.skippedFundCode++;
				continue;
			}
		}

		const typeRaw = get('type').trim().toLowerCase();
		let type: Transaction['type'];
		if (['buy', '买入', '加仓'].includes(typeRaw)) type = 'buy';
		else if (['sell', '卖出', '减仓'].includes(typeRaw)) type = 'sell';
		else if (['dividend', '分红', '红利'].includes(typeRaw)) type = 'dividend';
		else {
			result.invalidRows++;
			continue;
		}
		// 与笔记解析共用同一日期口径：容忍 2026-7-8 并补零，非法日历日仍计入无效行
		const date = normalizeRecordDate(get('date'));
		if (!date) {
			result.invalidRows++;
			continue;
		}
		const amount = num(get('amount'));
		const shares = num(get('shares'));
		const fee = num(get('fee'));
		const note = get('note');
		if (type === 'dividend') {
			if (!(amount > 0)) {
				result.invalidRows++;
				continue;
			}
		} else if (!(amount > 0 || shares > 0)) {
			result.invalidRows++;
			continue;
		}

		result.transactions.push({ type, date, amount, shares, fee, note });
	}
	return result;
}

function sig(tx: Transaction): string {
	return `${tx.type}|${tx.date}|${tx.amount}|${tx.shares}|${tx.fee}|${tx.note}`;
}

/** 过滤掉与已有记录完全重复的导入项 */
export function dedupeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
	const seen = new Set(existing.map(sig));
	return incoming.filter((tx) => {
		const s = sig(tx);
		if (seen.has(s)) return false;
		seen.add(s);
		return true;
	});
}

/** 导出：将交易记录序列化为带表头的 CSV（含关键字段） */
export function transactionsToCsv(transactions: Transaction[], fundCode?: string): string {
	const header = fundCode ? 'fundCode,' : '';
	const rows = [`${header}type,date,amount,shares,fee,note`];
	for (const t of transactions) {
		const cells = fundCode ? [fundCode] : [];
		cells.push(t.type, t.date, fmt(t.amount), fmt(t.shares), fmt(t.fee), t.note);
		rows.push(stringifyCsv(cells));
	}
	return rows.join('\n');
}

function fmt(v: number): string {
	if (v === 0) return '';
	return String(Math.round(v * 1e12) / 1e12);
}

/** 触发浏览器下载一个 .csv 文件 */
export function downloadCsv(filename: string, text: string): void {
	const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.body.createEl('a');
	a.href = url;
	a.download = filename;
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}