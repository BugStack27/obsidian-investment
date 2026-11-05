import {
	RECORD_BLOCK_LANG,
	type RecordLineError,
	type RecordParse,
	type Transaction,
} from '../types';
import { isRecordFence, parseFenceAttrs, type BlockAttrs } from './blockAttrs';
import { parse as parseCsv, stringify as stringifyCsv } from './csv';
import { normalizeRecordDate } from './recordDate';

function isBlankOrComment(line: string): boolean {
	const t = line.trim();
	return t.length === 0 || t.startsWith('#');
}

const RECORD_TYPES = ['buy', 'sell', 'dividend'];

/** 长得像日期的单元格，用于识别"列错位"与"疑似记录行" */
const DATE_LIKE = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/;

function isKnownType(v: string | undefined): boolean {
	return RECORD_TYPES.includes((v ?? '').trim().toLowerCase());
}

/**
 * 该行是否"看起来是交易记录"：首列是已知类型，或列数够且某列长得像日期。
 * 目的是让块内的说明文字不被误报成坏行。
 */
function looksLikeRecord(cells: string[]): boolean {
	const head = (cells[0] ?? '').trim();
	if (isKnownType(head)) return true;
	return (
		cells.length >= 3 &&
		head !== '' &&
		head.length <= 12 &&
		!/\s/.test(head) &&
		cells.some((c) => DATE_LIKE.test(c))
	);
}

/** 已确定解析失败的行归因（只影响提示文案，不改变解析结果） */
function classifyFailure(cells: string[]): RecordLineError {
	if (!isKnownType(cells[0])) return 'type';
	// 走到这里说明类型合法、日期列通不过，只剩"连日期列都没有"这一种缺列情形
	if (cells.length < 2) return 'columns';
	// 别的列里能找到日期 → 列错位；否则是日期本身非法
	return cells.slice(2).some((c) => normalizeRecordDate(c) != null) ? 'layout' : 'date';
}

/** 解析单行 CSV：buy,YYYY-MM-DD,金额[,份额][,手续费][,备注] */
export function parseRecordLine(line: string): Transaction | null {
	const t = line.trim();
	if (isBlankOrComment(t)) return null;
	const cells = parseCsv(t).map((c) => c.trim());

	const typeRaw = (cells[0] ?? '').trim().toLowerCase();
	if (!isKnownType(typeRaw)) return null;
	// 日期归一化后仍不合法的行丢弃；原文不改写，编辑该行时才会写成规范格式
	const date = normalizeRecordDate(cells[1]);
	if (!date) return null;

	return {
		// 已由 isKnownType 收敛过，类型白名单只此一份
		type: typeRaw as Transaction['type'],
		date,
		amount: toNumber(cells[2]),
		shares: toNumber(cells[3]),
		fee: toNumber(cells[4]),
		note: cells[5] ?? '',
	};
}

function toNumber(v: string | undefined): number {
	if (v == null || v.trim() === '') return 0;
	const n = Number(String(v).replace(/,/g, ''));
	return Number.isFinite(n) ? n : 0;
}

/** 将交易记录序列化为一行 CSV（用于追加） */
export function serializeTransaction(tx: Transaction): string {
	return stringifyCsv([tx.type, tx.date, fmtNum(tx.amount), fmtNum(tx.shares), fmtNum(tx.fee), tx.note]);
}

function fmtNum(v: number): string {
	if (v === 0) return '';
	// 保留足够精度（份额可到小数点后多位），去掉多余尾零
	let s = String(Math.round(v * 1e12) / 1e12);
	if (s.includes('.')) s = s.replace(/\.?0+$/, '');
	return s;
}

/** 解析 record 代码块内容 */
export function parseRecordSource(source: string): RecordParse {
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	const entries: RecordParse['entries'] = [];
	const unparsed: RecordParse['unparsed'] = [];
	lines.forEach((line, lineIdx) => {
		// 空行/注释不是"解析失败"，必须在解析前排除，否则会被当成坏行上报
		if (isBlankOrComment(line)) return;
		const tx = parseRecordLine(line);
		if (tx) {
			entries.push({ tx, lineIdx });
			return;
		}
		const cells = parseCsv(line.trim()).map((c) => c.trim());
		if (looksLikeRecord(cells)) unparsed.push({ lineIdx, reason: classifyFailure(cells) });
	});
	return { lines, entries, unparsed };
}

/** 在代码块末尾追加若干条记录，返回新的代码块内容 */
export function appendRecords(source: string, txs: Transaction[]): string {
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	// 去掉末尾空行
	while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
	const out: string[] = [...lines];
	if (out.length > 0) out.push(''); // 与最后一行之间留空行
	for (const tx of txs) out.push(serializeTransaction(tx));
	return out.join('\n').replace(/^\n+/, '');
}

/** 删除代码块中某条记录所在行，返回新内容与新的源码（未变则返回 null） */
export function removeRecordAtLine(source: string, lineIdx: number): string | null {
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	if (lineIdx < 0 || lineIdx >= lines.length) return null;
	lines.splice(lineIdx, 1);
	return lines.join('\n');
}

/** 替换代码块中某条记录所在行 */
export function replaceRecordAtLine(source: string, lineIdx: number, tx: Transaction): string | null {
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	if (lineIdx < 0 || lineIdx >= lines.length) return null;
	lines[lineIdx] = serializeTransaction(tx);
	return lines.join('\n');
}

/** 内容中的一个 record 代码块 */
export interface RecordBlock {
	/** 开 fence 行在内容中的行号（0 基） */
	fenceLine: number;
	/** 块内内容（不含 fence 行） */
	inner: string;
	/** fence 行上的属性 */
	attrs: BlockAttrs;
}

/** 列出内容中全部指定语言的 record 代码块（按出现顺序，含 fence 行号与属性） */
export function listRecordBlocks(content: string, lang: string = RECORD_BLOCK_LANG): RecordBlock[] {
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const blocks: RecordBlock[] = [];
	let open = -1;
	let attrInfo = '';
	for (let i = 0; i < lines.length; i++) {
		const info = isRecordFence(lines[i]!, lang);
		if (info != null) {
			// 嵌套/重复开 fence 时以最后一个为准（与闭 fence 的 first-match 语义一致即可）
			open = i;
			attrInfo = info;
			continue;
		}
		if (open < 0 || !lines[i]!.trim().startsWith('```')) continue;
		blocks.push({
			fenceLine: open,
			inner: lines.slice(open + 1, i).join('\n'),
			attrs: parseFenceAttrs(attrInfo),
		});
		open = -1;
		attrInfo = '';
	}
	return blocks;
}

/** 取 fenceLine 之后到下一个闭 fence 之间的块内内容；无闭 fence 返回 null */
export function blockInnerAt(lines: string[], fenceLine: number): string | null {
	for (let j = fenceLine + 1; j < lines.length; j++) {
		if (lines[j]!.trim().startsWith('```')) return lines.slice(fenceLine + 1, j).join('\n');
	}
	return null;
}

/** 从整份笔记内容中提取第一个指定语言 record 块；无块返回 null */
export function getFirstRecordBlock(
	content: string,
	lang: string = RECORD_BLOCK_LANG,
): RecordBlock | null {
	return listRecordBlocks(content, lang)[0] ?? null;
}

/** 从整份笔记内容中提取第一个指定语言 record 代码块的内部源码；无块返回 null */
export function getFirstRecordInner(content: string, lang: string = RECORD_BLOCK_LANG): string | null {
	return getFirstRecordBlock(content, lang)?.inner ?? null;
}