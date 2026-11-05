/** record 代码块 fence 行属性：注册表与解析 */

/** 单个可识别属性的定义 */
export interface BlockAttrSpec {
	/** 属性规范写法（匹配时大小写不敏感，补全时使用此写法） */
	name: string;
	/** 用途说明（供编辑器补全与文档展示） */
	desc: string;
}

/** 关闭买卖点提醒的属性名（提醒链路各消费端统一引用，避免字面量分散） */
export const ATTR_SKIP_TRADE_NOTIFY = 'skipTradeNotify';

/** fund-record 支持的属性注册表；新增属性只在此追加 */
export const FUND_RECORD_ATTRS: BlockAttrSpec[] = [
	{ name: ATTR_SKIP_TRADE_NOTIFY, desc: '关闭该基金的买卖点提醒' },
];

/** 解析结果：命中的属性（统一小写）与无法识别的属性（保留原样） */
export interface BlockAttrs {
	flags: Set<string>;
	unknown: string[];
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断某行是否为指定语言的开 fence 行（```lang 后可跟空白分隔的属性）。
 * 命中返回属性原文（无属性返回空串），非 fence 行返回 null。
 */
export function isRecordFence(line: string, lang: string): string | null {
	const m = new RegExp('^```' + escapeRegExp(lang) + '(?:\\s+(.*))?$').exec(line.trim());
	return m ? (m[1] ?? '').trim() : null;
}

/** 解析 fence 行属性文本：空白分隔、大小写不敏感、去重 */
export function parseFenceAttrs(
	info: string,
	specs: BlockAttrSpec[] = FUND_RECORD_ATTRS,
): BlockAttrs {
	const flags = new Set<string>();
	const unknown: string[] = [];
	const known = new Set(specs.map((s) => s.name.toLowerCase()));
	for (const token of info.split(/\s+/)) {
		if (token.length === 0) continue;
		const lower = token.toLowerCase();
		if (known.has(lower)) flags.add(lower);
		else if (!unknown.includes(token)) unknown.push(token);
	}
	return { flags, unknown };
}

/** 判断属性集合是否命中某属性（大小写不敏感） */
export function hasAttr(attrs: BlockAttrs, name: string): boolean {
	return attrs.flags.has(name.toLowerCase());
}

/** 解析某行的属性；非 fence 行返回 null */
export function fenceAttrs(
	line: string,
	lang: string,
	specs: BlockAttrSpec[] = FUND_RECORD_ATTRS,
): BlockAttrs | null {
	const info = isRecordFence(line, lang);
	return info == null ? null : parseFenceAttrs(info, specs);
}

/**
 * 在 lineStart 附近（±window 行）查找开 fence 行并返回其**行号**；未命中返回 null。
 * 代码块处理器无法直接拿到 fence 行，只能靠 `ctx.getSectionInfo` 给出的行号反查；
 * 不同 Obsidian 版本对代码块的 lineStart 指向（开 fence 行 / 首个内容行 / 所属标题行）不一致，故做窗口查找。
 * 注意：命中行号并不等于「就是当前块」，调用方必须再用块内内容二次验证（见 `locateBlockAttrs`）。
 */
export function findFenceLineNear(
	lines: string[],
	lineStart: number,
	lang: string,
	window = 2,
): number | null {
	for (let d = 0; d <= window; d++) {
		const candidates = d === 0 ? [lineStart] : [lineStart - d, lineStart + d];
		for (const i of candidates) {
			if (i < 0 || i >= lines.length) continue;
			if (isRecordFence(lines[i]!, lang) != null) return i;
		}
	}
	return null;
}
