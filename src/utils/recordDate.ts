/**
 * 交易记录日期的统一口径：弹窗录入、笔记解析、批量导入三条路径共用。
 * 笔记里的记录行格式为 `type,date,...`，date 必须是 YYYY-MM-DD，否则下游解析会丢弃该行。
 */

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

/** 严格校验：必须是逐字规范的 YYYY-MM-DD 且真实存在（拒绝 2026-7-8、2026-13-01、2026-2-30） */
export function isValidRecordDate(s: string): boolean {
	return normalizeRecordDate(s) === s;
}

/**
 * 归一化为 YYYY-MM-DD；接受月/日为 1 位的写法（2026-7-8 → 2026-07-08）。
 * 不合法的日历日（含 / . 分隔、紧凑 8 位）返回 null。
 * 容忍首尾空白：宁可归一化也不判非法——被判非法的行会被下游静默丢弃，正是本次要消灭的故障。
 */
export function normalizeRecordDate(s: string | undefined): string | null {
	const m = DATE_RE.exec((s ?? '').trim());
	if (!m) return null;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	// Date 会把 0-99 的年份映射到 19xx，故显式限制年份范围
	if (y < 1000 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	const dt = new Date(y, mo - 1, d);
	if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
	return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 本地当天 YYYY-MM-DD */
export function todayStr(): string {
	const now = new Date();
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
