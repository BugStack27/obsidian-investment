import type { RecordLineError, UnparsedRecordLine } from '../types';

const REASON_LABEL: Record<RecordLineError, string> = {
	columns: '列数不足',
	type: '类型无法识别',
	date: '日期非法',
	layout: '日期列错位',
};

/** 拼装"无法解析的行"提示文案；无坏行返回空串。行号按块内 1 基展示 */
export function formatUnparsedHint(unparsed: UnparsedRecordLine[], max = 10): string {
	if (unparsed.length === 0) return '';
	const shown = unparsed.slice(0, max);
	const parts = shown.map((u) => `第 ${u.lineIdx + 1} 行（${REASON_LABEL[u.reason]}）`);
	const rest = unparsed.length - shown.length;
	return `${unparsed.length} 行无法解析：${parts.join('、')}${rest > 0 ? ` 等 ${rest} 行` : ''}｜这些行不会计入表格与收益，请修正或删除`;
}

/** 在记录块顶部渲染坏行提示；无坏行时不创建任何节点 */
export function renderUnparsedHint(el: HTMLElement, unparsed: UnparsedRecordLine[]): void {
	const text = formatUnparsedHint(unparsed);
	if (text) el.createEl('p', { text, cls: 'inv-hint inv-attr-warn' });
}
