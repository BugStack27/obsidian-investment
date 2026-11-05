import { RECORD_BLOCK_LANG } from '../types';
import { findFenceLineNear, isRecordFence, parseFenceAttrs, type BlockAttrs } from './blockAttrs';
import { blockInnerAt, listRecordBlocks, type RecordBlock } from './recordParser';

/** 归一化块内内容：统一换行、去掉首尾空行（比对 source 与磁盘内容时用） */
export function normalizeInner(s: string): string {
	return s.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
}

/**
 * 定位「当前正在渲染的那个 record 块」的 fence 行属性。
 *
 * 背景：代码块处理器只拿到块内内容（`source`）与段起始行号，却拿不到 fence 行。而同一笔记
 * 可以存在多个 record 块，因此任何单一信号都不足以定位：
 * - 行号反查快但在部分 Obsidian 版本里 `lineStart` 指向所属标题行，±窗口可能命中邻近的**别的**块；
 * - 块内内容匹配在多个块内容相同时无法区分。
 *
 * 故采用两级策略：
 * 1. 行号附近找到 fence 行后，**必须用其块内内容与 source 比对通过**才采信（防止串块）；
 * 2. 否则列出全部 record 块：优先取块内内容与 source 相同者，多个同内容时取离 lineStart 最近者；
 *    完全没有内容匹配（异常情况）时退化为离 lineStart 最近的块。
 *
 * 已知局限：同一笔记内存在**多个块内内容完全相同**的 record 块时，仅靠上方信息无法进一步区分；
 * 此类笔记本就属于插件的未定义用法（数据链路同样只认第一个块），此时按距离择近取近似结果。
 */
export function locateBlockAttrs(
	text: string,
	source: string,
	lineStart: number | null,
	lang: string = RECORD_BLOCK_LANG,
): BlockAttrs {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (lineStart != null) {
		const fenceLine = findFenceLineNear(lines, lineStart, lang);
		if (fenceLine != null) {
			const inner = blockInnerAt(lines, fenceLine);
			if (inner != null && normalizeInner(inner) === normalizeInner(source)) {
				return parseFenceAttrs(isRecordFence(lines[fenceLine]!, lang) ?? '');
			}
		}
	}
	const target = pickBlock(listRecordBlocks(text, lang), source, lineStart);
	return target ? target.attrs : parseFenceAttrs('');
}

/** 在候选块中选出当前块：内容相同者优先，同内容时取离 lineStart 最近者 */
function pickBlock(
	blocks: RecordBlock[],
	source: string,
	lineStart: number | null,
): RecordBlock | null {
	if (blocks.length === 0) return null;
	const want = normalizeInner(source);
	const same = blocks.filter((b) => normalizeInner(b.inner) === want);
	const pool = same.length > 0 ? same : blocks;
	if (pool.length === 1 || lineStart == null) return pool[0]!;
	return pool.reduce((best, b) =>
		Math.abs(b.fenceLine - lineStart) < Math.abs(best.fenceLine - lineStart) ? b : best,
	);
}
