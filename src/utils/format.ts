export function fmtMoney(v: number, digits = 2): string {
	if (!Number.isFinite(v)) return '-';
	const sign = v < 0 ? '-' : '';
	const abs = Math.abs(v);
	return `${sign}¥${abs.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtSigned(v: number, digits = 2): string {
	if (!Number.isFinite(v)) return '-';
	const sign = v > 0 ? '+' : '';
	return `${sign}${v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 带正负号的金额（如 +¥1,234.56） */
export function fmtSignedMoney(v: number, digits = 2): string {
	if (!Number.isFinite(v)) return '-';
	const sign = v > 0 ? '+' : v < 0 ? '-' : '';
	return `${sign}¥${Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPercent(v: number, digits = 2, withSign = false): string {
	if (!Number.isFinite(v)) return '-';
	const sign = withSign && v > 0 ? '+' : '';
	return `${sign}${(v * 100).toFixed(digits)}%`;
}

/** 颜色：正收益红（A股习惯）、负收益绿 */
export function profitColor(v: number): string {
	if (v > 0) return 'var(--text-error)';
	if (v < 0) return 'var(--text-success)';
	return 'var(--text-muted)';
}

export function fmtShares(v: number, digits = 2): string {
	if (!Number.isFinite(v)) return '-';
	return v.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function className(...names: (string | false | null | undefined)[]): string {
	return names.filter(Boolean).join(' ');
}