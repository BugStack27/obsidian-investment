import {
	EditorSuggest,
	type Editor,
	type EditorPosition,
	type EditorSuggestContext,
	type EditorSuggestTriggerInfo,
	type TFile,
} from 'obsidian';
import { RECORD_BLOCK_LANG } from '../types';
import { FUND_RECORD_ATTRS, isRecordFence, parseFenceAttrs, type BlockAttrSpec } from '../utils/blockAttrs';

/**
 * 记录块 fence 行属性补全：源码模式下在 ```` ```fund-record ```` 行内输入时，
 * 提示可用的属性名（当前为 skipTradeNotify），避免用户凭记忆手写。
 * 仅在光标所在行本身是该语言的 fence 行时触发，正文与其他代码块不受影响。
 */
export class RecordAttrSuggest extends EditorSuggest<BlockAttrSpec> {
	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// 整行必须是 ```fund-record [已输入属性]；语言名未写完时不匹配即不触发
		const info = isRecordFence(line, RECORD_BLOCK_LANG);
		if (info == null) return null;

		const before = line.slice(0, cursor.ch);
		const lastSpace = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\t'));
		const start: EditorPosition = { line: cursor.line, ch: lastSpace + 1 };
		// end 取当前 token 末尾（而非光标处）：光标停在 token 中间时补全应整体替换该 token
		const rest = line.slice(cursor.ch).search(/[ \t]/);
		const end: EditorPosition = {
			line: cursor.line,
			ch: rest < 0 ? line.length : cursor.ch + rest,
		};
		return { start, end, query: before.slice(start.ch) };
	}

	getSuggestions(context: EditorSuggestContext): BlockAttrSpec[] {
		// 已在本行完成输入的属性不再重复提示（排除的是当前正在输入的那一段之前的内容）
		const used = parseFenceAttrs(context.editor.getLine(context.start.line).slice(0, context.start.ch)).flags;
		const prefix = context.query.toLowerCase();
		return FUND_RECORD_ATTRS.filter(
			(spec) => !used.has(spec.name.toLowerCase()) && spec.name.toLowerCase().startsWith(prefix),
		);
	}

	renderSuggestion(value: BlockAttrSpec, el: HTMLElement): void {
		el.addClass('inv-attr-suggest');
		el.createSpan({ text: value.name, cls: 'inv-attr-suggest-name' });
		el.createSpan({ text: value.desc, cls: 'inv-attr-suggest-desc' });
	}

	selectSuggestion(value: BlockAttrSpec): void {
		const context = this.context;
		if (!context) return;
		// 补全后追加空格，便于继续输入下一个属性
		context.editor.replaceRange(`${value.name} `, context.start, context.end);
		this.close();
	}
}
