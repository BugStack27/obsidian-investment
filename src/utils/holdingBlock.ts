import { App, TFile } from 'obsidian';
import { findBlockRange } from './recordMutation';
import { parse as parseCsv, stringify as stringifyCsv } from './csv';

/** 手动补充持仓代码块的语言标识（```fund-holding） */
export const HOLDING_BLOCK_LANG = 'fund-holding';

/** fund-holding 块中的一行：编码 / 名称 / 比例(%，可空) / 是否当前持仓 */
export interface FundHoldingRow {
	/** 6 位 A 股代码 */
	code: string;
	name: string;
	/** 占净值比（%），未填为 null */
	ratio: number | null;
	/** 是否当前持仓；否 = 仅存档不参与估值图表 */
	active: boolean;
}

const HOLDING_HEADER = '编码,名称,比例,当前持仓';

/** 归一化股票代码：取数字后 6 位（容忍 sh600519 等前缀）；无法得到 6 位返回 null */
export function normalizeHoldingCode(raw: string): string | null {
	const digits = raw.replace(/\D/g, '');
	return digits.length >= 6 ? digits.slice(-6) : null;
}

function toRatio(v: string | undefined): number | null {
	const t = (v ?? '').trim();
	if (t === '') return null;
	const n = Number(t.replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
}

function isActiveValue(v: string | undefined): boolean {
	return /^(y|yes|true|1|是)$/i.test((v ?? '').trim());
}

/**
 * 解析 fund-holding 代码块内容。
 * 跳过空行与 # 注释；表头行（首个单元格不是有效代码）自动跳过；同一代码只保留首行。
 */
export function parseHoldingSource(source: string): FundHoldingRow[] {
	const rows: FundHoldingRow[] = [];
	const seen = new Set<string>();
	for (const line of source.replace(/\r\n/g, '\n').split('\n')) {
		const t = line.trim();
		if (t.length === 0 || t.startsWith('#')) continue;
		const cells = parseCsv(t).map((c) => c.trim());
		const code = normalizeHoldingCode(cells[0] ?? '');
		if (!code || seen.has(code)) continue;
		seen.add(code);
		rows.push({
			code,
			name: cells[1] ?? '',
			ratio: toRatio(cells[2]),
			// 旧行/缺列默认视为当前持仓
			active: cells.length >= 4 ? isActiveValue(cells[3]) : true,
		});
	}
	return rows;
}

/** 序列化为 fund-holding 块内容（含中文表头，便于在笔记中手改） */
export function serializeHoldingRows(rows: FundHoldingRow[]): string {
	const lines: string[] = [`# 手动补充持仓（CSV，每行：${HOLDING_HEADER}；当前持仓填「是」才参与估值图表）`];
	lines.push(HOLDING_HEADER);
	for (const r of rows) {
		lines.push(
			stringifyCsv([r.code, r.name, r.ratio == null ? '' : String(r.ratio), r.active ? '是' : '否']),
		);
	}
	return lines.join('\n');
}

/** 读取基金笔记 fund-holding 块中的手动持仓（无块/无文件返回 []） */
export async function readHoldingRows(app: App, filePath: string): Promise<FundHoldingRow[]> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) return [];
	const content = await app.vault.cachedRead(file);
	const lines = content.replace(/\r\n/g, '\n').split('\n');
	const block = findBlockRange(lines, HOLDING_BLOCK_LANG);
	if (!block) return [];
	const inner = lines.slice(block.innerStart, block.innerEnd).join('\n');
	return parseHoldingSource(inner);
}

/** 将手动持仓写回基金笔记的 fund-holding 块（无块则在文件末尾追加一个） */
export async function writeHoldingRows(app: App, filePath: string, rows: FundHoldingRow[]): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) throw new Error('找不到基金笔记文件');
	const inner = serializeHoldingRows(rows).split('\n');
	await app.vault.process(file, (content) => {
		const normalized = content.replace(/\r\n/g, '\n');
		const lines = normalized.split('\n');
		const block = findBlockRange(lines, HOLDING_BLOCK_LANG);
		if (block) {
			return [...lines.slice(0, block.innerStart), ...inner, ...lines.slice(block.innerEnd)].join('\n');
		}
		const sep = normalized.length === 0 || normalized.endsWith('\n') ? '\n' : '\n\n';
		return `${normalized}${sep}\`\`\`${HOLDING_BLOCK_LANG}\n${inner.join('\n')}\n\`\`\`\n`;
	});
}
