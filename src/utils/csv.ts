/** 极简 CSV 解析/序列化：支持双引号包裹与转义，足够处理 record 代码块单行记录 */

/** 解析一行 CSV 为单元格数组 */
export function parse(line: string): string[] {
	const cells: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]!;
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			cells.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	cells.push(cur);
	return cells;
}

/** 将单元格数组序列化为一行 CSV */
export function stringify(cells: (string | number)[]): string {
	return cells
		.map((c) => {
			const s = String(c);
			if (s.includes(',') || s.includes('"') || s.includes('\n')) {
				return `"${s.replace(/"/g, '""')}"`;
			}
			return s;
		})
		.join(',');
}