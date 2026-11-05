import { Menu } from 'obsidian';
import type { FundLoadFailure } from '../services/fundAnalysis';

/** 失败清单的交互回调 */
export interface FundFailureHandlers {
	/** 打开该基金笔记，便于核对 */
	onOpen: (failure: FundLoadFailure) => void;
	/** 重新加载：再走一次数据中枢全量刷新 */
	onRetry: () => void;
}

/** 悬浮提示文本：`名称（代码）— 短原因（原始报错）；…` */
export function failureLineText(failures: FundLoadFailure[]): string {
	return failures
		.map((f) => {
			const detail = f.detail && f.detail !== f.reason ? `（${f.detail}）` : '';
			return `${f.name}（${f.code}）— ${f.reason}${detail}`;
		})
		.join('；');
}

/** 点击失败计数行弹出菜单：逐只基金可打开笔记（标题带短原因），末尾重新加载 */
export function openFundFailureMenu(
	evt: MouseEvent,
	failures: FundLoadFailure[],
	handlers: FundFailureHandlers,
): void {
	const menu = new Menu();
	for (const f of failures) {
		menu.addItem((item) =>
			item
				.setTitle(`${f.name}（${f.code}）· ${f.reason}`)
				.onClick(() => handlers.onOpen(f)),
		);
	}
	menu.addSeparator();
	menu.addItem((item) => item.setTitle('重新加载').setIcon('refresh-cw').onClick(handlers.onRetry));
	menu.showAtMouseEvent(evt);
}

/**
 * 单行失败计数（汇总卡底部 / 状态栏共用）：`N 只基金未纳入统计`，
 * 悬浮显示名单，点击弹菜单；`showRetry` 时右侧追加「重新加载」按钮。失败清单为空时不渲染。
 */
export function renderFundFailureLine(
	parent: HTMLElement,
	failures: FundLoadFailure[],
	handlers: FundFailureHandlers,
	showRetry = false,
): void {
	if (failures.length === 0) return;
	const line = parent.createSpan({
		text: `${failures.length} 只基金未纳入统计`,
		cls: 'inv-failure-line',
		attr: { title: failureLineText(failures) },
	});
	line.addEventListener('click', (evt) => openFundFailureMenu(evt, failures, handlers));
	if (!showRetry) return;
	const retry = parent.createEl('button', { text: '重新加载', cls: 'inv-failure-retry' });
	retry.addEventListener('click', (evt) => {
		evt.stopPropagation();
		handlers.onRetry();
	});
}

/**
 * 块级失败提示（侧栏全部失败 / 近期操作弹窗共用）：
 * 标题（默认「其余数字不含这些基金」，可替换为场景说明）+ 重新加载按钮 + 逐只基金行
 * （点击打开笔记，tooltip 为原始报错）。
 */
export function renderFundFailureNotice(
	parent: HTMLElement,
	failures: FundLoadFailure[],
	handlers: FundFailureHandlers,
	hint = '其余数字不含这些基金',
): void {
	if (failures.length === 0) return;
	const box = parent.createDiv({ cls: 'inv-failure-notice' });
	const head = box.createDiv({ cls: 'inv-failure-head' });
	head.createSpan({ text: `${failures.length} 只基金未纳入统计，${hint}` });
	head
		.createEl('button', { text: '重新加载', cls: 'inv-failure-retry' })
		.addEventListener('click', () => handlers.onRetry());

	for (const f of failures) {
		const row = box.createDiv({ cls: 'inv-failure-item' });
		row.createSpan({ text: `${f.name}（${f.code}）`, cls: 'inv-failure-name' });
		row.createSpan({ text: f.reason, cls: 'inv-failure-reason' });
		row.title = f.detail || f.reason;
		row.addEventListener('click', () => handlers.onOpen(f));
	}
}
