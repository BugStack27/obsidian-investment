import { App, TFile } from 'obsidian';
import { RECORD_BLOCK_LANG, type Transaction } from '../types';
import { isRecordFence } from './blockAttrs';
import { appendRecords } from './recordParser';

const FENCE = '```';

/**
 * 定位文件中第一个指定语言 record 代码块内部行区间（不含 fence 行）；无块时返回 null。
 * 开 fence 行允许带属性（```fund-record skipTradeNotify），此处必须属性感知，否则带属性的块无法写回。
 */
export function findBlockRange(
	lines: string[],
	lang: string = RECORD_BLOCK_LANG,
): { innerStart: number; innerEnd: number } | null {
	let open = -1;
	for (let i = 0; i < lines.length; i++) {
		if (isRecordFence(lines[i]!, lang) != null) {
			open = i;
			break;
		}
	}
	if (open < 0) return null;
	for (let j = open + 1; j < lines.length; j++) {
		if (lines[j]!.trim().startsWith(FENCE)) {
			return { innerStart: open + 1, innerEnd: j };
		}
	}
	return null;
}

/** 定位不到可写代码块的原因：缺整个块，还是有开 fence 却没有结束 fence */
function missingBlockReason(lines: string[], lang: string): string {
	if (!lines.some((line) => isRecordFence(line, lang) != null)) {
		return `笔记中没有 ${lang} 代码块，无法写入记录`;
	}
	return `笔记中的 ${lang} 代码块缺少结束的 ${FENCE}，无法写入记录`;
}

/**
 * 对文件中第一个指定语言 record 代码块做内容变换并写回（只替换块内内容，保留其余笔记）。
 * 定位不到可写代码块时抛错：静默跳过会让调用方误以为记录已写入。
 */
export async function transformRecordBlock(
	app: App,
	file: TFile,
	transform: (inner: string) => string,
	lang: string = RECORD_BLOCK_LANG,
): Promise<void> {
	await app.vault.process(file, (content) => {
		const lines = content.replace(/\r\n/g, '\n').split('\n');
		const block = findBlockRange(lines, lang);
		if (!block) throw new Error(missingBlockReason(lines, lang));
		const inner = lines.slice(block.innerStart, block.innerEnd).join('\n');
		const next = transform(inner).replace(/\r\n/g, '\n').split('\n');
		return [...lines.slice(0, block.innerStart), ...next, ...lines.slice(block.innerEnd)].join('\n');
	});
}

/** 在文件第一个指定语言 record 代码块末尾追加若干交易记录（快捷记录买入/卖出用） */
export async function appendTxToFile(
	app: App,
	file: TFile,
	txs: Transaction[],
	lang: string = RECORD_BLOCK_LANG,
): Promise<void> {
	await transformRecordBlock(app, file, (inner) => appendRecords(inner, txs), lang);
}