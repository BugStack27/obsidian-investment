import { Modal, Notice, TFile } from 'obsidian';
import type InvestmentPlugin from '../main';
import { groupRecentTrades, shiftDateKey, type RecentTradeGroup } from '../services/recentTrades';
import { resolveAvailableShares } from '../services/positionHolding';
import { todayKey } from '../services/signalAlerts';
import { sortTodayTrades } from '../services/todayTrades';
import { RECORD_BLOCK_LANG, STOCK_RECORD_BLOCK_LANG } from '../types';
import { className } from '../utils/format';
import { appendTxToFile } from '../utils/recordMutation';
import { renderFundFailureNotice, type FundFailureHandlers } from './fundFailureNotice';
import { PositionTradeModal } from './positionTradeModal';
import { openTradeNote, renderTradeSummary, renderTradeTable } from './tradeList';

const RANGE_OPTIONS = [
	{ days: 1, label: '今日' },
	{ days: 7, label: '7 天' },
	{ days: 30, label: '30 天' },
	{ days: 90, label: '90 天' },
] as const;
const DEFAULT_RANGE = 30;
const COLUMNS = ['类型', '标的', '金额', '份额/数量', '参考净值', '手续费', '备注'];
const COLUMNS_WITH_HOLD = ['类型', '标的', '金额', '持有金额', '份额/数量', '参考净值', '手续费', '备注'];

/**
 * 「近期操作」弹窗：按日期倒序分组，列出近 7/30/90 天已录入的全部买入/卖出记录（基金 + 股票），
 * 供用户对照券商/平台流水，人工排查哪些操作还没录入到笔记里。
 * 另含「今日」档（1 天窗口）：保留原「今日操作」视角，额外展示持有金额并按持仓市值降序。
 *
 * 数据取数据中枢快照 `recentTrades`（已按日期倒序排好）；切换窗口只做本地裁剪，不重新扫库。
 * `full` / `status` 变更时重渲染，盘中估值变更与本列表无关故忽略。点击任意一行打开对应笔记。
 */
export class RecentTradesModal extends Modal {
	private readonly plugin: InvestmentPlugin;
	private days: number = DEFAULT_RANGE;
	private bodyEl: HTMLElement | null = null;
	private storeUnsub: (() => void) | null = null;

	constructor(plugin: InvestmentPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.modalEl.addClass('inv-recent-trades-modal');
		this.setTitle('近期操作');
		this.bodyEl = this.contentEl.createDiv({ cls: 'inv-today-body' });

		this.storeUnsub = this.plugin.store.subscribe((s) => {
			// 盘中估值刷新不影响操作记录；其余变更（全量重建/状态变更）需要重绘
			if (s.change === 'estimate') return;
			this.render();
		});
		this.render();
	}

	onClose(): void {
		if (this.storeUnsub) {
			this.storeUnsub();
			this.storeUnsub = null;
		}
		this.bodyEl = null;
		this.contentEl.empty();
	}

	private render(): void {
		const el = this.bodyEl;
		if (!el) return;
		const today = todayKey();
		const isTodayView = this.days === 1;
		const { failedFunds } = this.plugin.store.snapshot;
		const groups = groupRecentTrades(this.plugin.store.snapshot.recentTrades, this.days, today);
		// 今日档沿用原今日弹窗的权重视角：买入组 → 卖出组，组内按持有金额降序
		const todayGroup = groups[0];
		if (isTodayView && todayGroup) {
			todayGroup.trades = sortTodayTrades(todayGroup.trades);
		}
		const trades = groups.flatMap((g) => g.trades);
		el.empty();

		this.renderToolbar(el, today, trades.length);
		renderTradeSummary(el, trades);

		// 加载失败的基金其记录不会出现在下方列表：常驻点名，避免把缺账误读为没操作
		renderFundFailureNotice(
			el,
			failedFunds,
			this.failureHandlers(),
			isTodayView ? '其今日的买卖记录未纳入本列表' : `其近 ${this.days} 天的买卖记录未纳入本列表`,
		);

		const rangeLabel = isTodayView ? '今日' : `近 ${this.days} 天`;
		if (trades.length === 0) {
			el.createEl('p', {
				text: failedFunds.length > 0
					? `${rangeLabel}暂无已纳入统计的买入 / 卖出操作。`
					: `${rangeLabel}暂无已录入的买入 / 卖出操作。`,
				cls: 'inv-hint',
			});
		} else {
			const columns = isTodayView ? COLUMNS_WITH_HOLD : COLUMNS;
			for (const group of groups) this.renderGroup(el, group, today, columns, isTodayView);
		}

		el.createDiv({
			text: isTodayView
				? '买入在前、卖出在后，组内按持有金额（持仓市值）降序；股票行情不可得时置底。仅列出买入 / 卖出记录，分红不计入；点击任意一行打开对应笔记。'
				: '按日期倒序分组，仅列出已录入的买入 / 卖出记录，分红不计入；可对照券商 / 平台流水核对是否有遗漏。点击任意一行打开对应笔记。',
			cls: 'inv-hint inv-today-foot',
		});
	}

	/** 顶部工具栏：窗口切换、实际范围与笔数、快捷补录入口 */
	private renderToolbar(parent: HTMLElement, today: string, count: number): void {
		const bar = parent.createDiv({ cls: 'inv-recent-toolbar' });

		const ranges = bar.createDiv({ cls: 'inv-recent-ranges' });
		for (const { days, label } of RANGE_OPTIONS) {
			const btn = ranges.createEl('button', {
				text: label,
				cls: className('inv-recent-range-btn', days === this.days && 'is-active'),
			});
			btn.addEventListener('click', () => {
				if (days === this.days) return;
				this.days = days;
				this.render();
			});
		}

		bar.createDiv({
			text: this.days === 1
				? `${today} · ${count} 条`
				: `${shiftDateKey(today, -(this.days - 1))} ~ ${today} · ${this.days} 天窗口 / ${count} 条`,
			cls: 'inv-recent-window',
		});

		// 与「加减仓」命令共用同一弹窗，保存后立即刷新列表便于对照
		bar.createEl('button', {
			text: '记一笔买卖',
			cls: 'inv-recent-trade-btn mod-cta',
		}).addEventListener('click', () => this.openTradeModal());
	}

	/** 打开统一加减仓弹窗；保存成功后写回记录并立即刷新数据流，使列表同步更新 */
	private openTradeModal(): void {
		new PositionTradeModal(
			this.plugin,
			{ resolveAvailableShares: (t) => resolveAvailableShares(this.plugin.app, t) },
			async (tx, target) => {
				const file = this.plugin.app.vault.getAbstractFileByPath(target.filePath);
				if (!(file instanceof TFile)) {
					new Notice('找不到笔记文件，无法写入记录');
					return;
				}
				try {
					await appendTxToFile(
						this.plugin.app,
						file,
						[tx],
						target.kind === 'stock' ? STOCK_RECORD_BLOCK_LANG : RECORD_BLOCK_LANG,
					);
					new Notice(`已记录：${target.name}`);
					// 立即重建快照（文件变更监听另有 1.2s 防抖刷新，二者幂等）
					await this.plugin.store.refresh();
				} catch (e) {
					new Notice(`记录失败：${e instanceof Error ? e.message : String(e)}`);
				}
			},
		).open();
	}

	/** 失败清单交互：打开对应笔记 / 重新加载 */
	private failureHandlers(): FundFailureHandlers {
		return {
			onOpen: (f) => openTradeNote(this.plugin.app, this.plugin.settings.openFundInEdit, f.filePath),
			onRetry: () => void this.plugin.store.refresh(),
		};
	}

	/** 单个日期分组：日期标题 + 当日记录表 */
	private renderGroup(
		parent: HTMLElement,
		group: RecentTradeGroup,
		today: string,
		columns: string[],
		showHoldValue: boolean,
	): void {
		const day = parent.createDiv({ cls: 'inv-recent-day' });
		const head = day.createDiv({ cls: 'inv-recent-day-head' });
		head.createSpan({ text: group.date, cls: 'inv-recent-date' });
		if (group.date === today) head.createSpan({ text: '今日', cls: 'inv-recent-today-tag' });
		head.createSpan({ text: `${group.trades.length} 条`, cls: 'inv-recent-day-count' });

		renderTradeTable(day, group.trades, {
			columns,
			showHoldValue,
			onOpen: (t) =>
				openTradeNote(this.plugin.app, this.plugin.settings.openFundInEdit, t.filePath),
		});
	}
}
