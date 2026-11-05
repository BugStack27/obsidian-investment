import { Notice, TFile, type App } from 'obsidian';
import type { TodayTrade } from '../services/todayTrades';
import { summarizeTodayTrades } from '../services/todayTrades';
import { className, fmtMoney, fmtShares } from '../utils/format';

const BUY_COLOR = 'var(--text-error)';
const SELL_COLOR = 'var(--text-success)';

/** 买卖汇总行：买入 / 卖出各显示笔数与金额（今日 / 近期操作弹窗共用） */
export function renderTradeSummary(parent: HTMLElement, trades: TodayTrade[]): void {
	const sum = summarizeTodayTrades(trades);
	const summary = parent.createDiv({ cls: 'inv-today-summary' });
	summaryItem(summary, '买入', sum.buyCount, sum.buyAmount, BUY_COLOR);
	summaryItem(summary, '卖出', sum.sellCount, sum.sellAmount, SELL_COLOR);
}

function summaryItem(
	parent: HTMLElement,
	label: string,
	count: number,
	amount: number,
	color: string,
): void {
	const box = parent.createDiv({ cls: 'inv-today-sum-item' });
	box.createSpan({ text: label, cls: 'inv-today-sum-label' });
	box.createSpan({ text: `${count} 笔`, cls: 'inv-today-sum-count' });
	const val = box.createSpan({ text: fmtMoney(amount), cls: 'inv-today-sum-amount' });
	val.style.color = color;
}

/**
 * 渲染交易表格：表头 + 各行（今日 / 近期操作弹窗共用）。
 * `columns` 必须与 `showHoldValue` 对应——为 true 时行内会在「金额」后插入「持有金额」列。
 */
export function renderTradeTable(
	parent: HTMLElement,
	trades: TodayTrade[],
	opts: { columns: string[]; showHoldValue: boolean; onOpen: (t: TodayTrade) => void },
): void {
	const table = parent.createEl('table', { cls: 'inv-today-table' });
	const headRow = table.createEl('thead').createEl('tr');
	for (const h of opts.columns) headRow.createEl('th', { text: h });

	const body = table.createEl('tbody');
	for (const t of trades) {
		renderTradeRow(body, t, {
			showHoldValue: opts.showHoldValue,
			onOpen: () => opts.onOpen(t),
		});
	}
}

/**
 * 渲染一行交易记录。
 * `showHoldValue` 控制是否插入「持有金额」列：今日档用作排序键需要展示，其余档不展示。
 */
function renderTradeRow(
	body: HTMLElement,
	t: TodayTrade,
	opts: { showHoldValue: boolean; onOpen: () => void },
): void {
	const isBuy = t.type === 'buy';
	const tr = body.createEl('tr', {
		cls: 'inv-today-row',
		attr: { title: '点击打开对应笔记' },
	});
	tr.addEventListener('click', opts.onOpen);

	const typeTd = tr.createEl('td');
	typeTd.createSpan({
		text: isBuy ? '买入' : '卖出',
		cls: className('inv-badge', isBuy ? 'inv-badge-buy' : 'inv-badge-sell'),
	});

	// 标的：来源标签 + 名称 + 代码
	const nameTd = tr.createEl('td');
	nameTd.createSpan({ text: t.kind === 'fund' ? '基金' : '股票', cls: 'inv-today-kind' });
	nameTd.createSpan({ text: t.name, cls: 'inv-today-name' });
	nameTd.createSpan({ text: t.code, cls: 'inv-today-code' });

	tr.createEl('td', { text: t.amount > 0 ? fmtMoney(t.amount) : '—', cls: 'inv-today-amount' });
	// 持有金额（持仓市值）：股票行情不可得时显示占位
	if (opts.showHoldValue) {
		tr.createEl('td', { text: t.holdValue != null ? fmtMoney(t.holdValue) : '—' });
	}
	tr.createEl('td', { text: t.shares > 0 ? fmtShares(t.shares) : '—' });
	tr.createEl('td', { text: tradeNavText(t) });
	tr.createEl('td', { text: t.fee > 0 ? fmtMoney(t.fee) : '—' });
	tr.createEl('td', { text: t.note || '—', cls: 'inv-today-note' });
}

/** 参考净值：基金的按日期补全值 /「待确认」；股票无净值口径，显示占位 */
function tradeNavText(t: TodayTrade): string {
	if (t.kind !== 'fund') return '—';
	if (t.nav != null) return t.nav.toFixed(4);
	return t.pending ? '待确认' : '—';
}

/** 按「基金/股票笔记默认打开模式」设置打开记录所在笔记，与侧栏卡片行为一致 */
export function openTradeNote(app: App, openInEdit: boolean, filePath: string): void {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		new Notice('找不到对应笔记文件');
		return;
	}
	const openState = openInEdit ? { state: { mode: 'source' } } : undefined;
	void app.workspace.getLeaf(false).openFile(file, openState);
}
