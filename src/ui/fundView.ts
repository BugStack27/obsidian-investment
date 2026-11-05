import { ItemView, WorkspaceLeaf } from 'obsidian';
import type InvestmentPlugin from '../main';
import type { StoreSnapshot } from '../data/investmentStore';
import type { RealtimeEstimate } from '../services/realtimeEstimate';
import type { FundCard } from '../services/portfolioOverview';
import type { StockCard } from '../services/stockPortfolio';
import { fmtMoney, fmtPercent, fmtSignedMoney, profitColor } from '../utils/format';
import { renderFundFailureNotice, type FundFailureHandlers } from './fundFailureNotice';
import { renderSummaryCard } from './summaryCard';
import { openTradeNote } from './tradeList';

export const FUND_VIEW_TYPE = 'fund-analysis-view';

/** 单只基金卡片内"盘中估值"单元格的引用，供估值刷新时原地更新 */
interface EstimateCell {
	label: HTMLElement;
	value: HTMLElement;
	sub: HTMLElement;
}

/**
 * 侧栏"全部基金"汇总视图：固定展示所有基金卡片 + 顶部汇总卡。
 * 纯渲染层：订阅数据流中枢快照，全量重建由 store 的 full 变更驱动，
 * 盘中估值由 estimate 变更原地刷新估值单元格（汇总卡"今日"由共享输出位统一更新）。
 */
export class FundView extends ItemView {
	plugin: InvestmentPlugin;
	private rendered = false;
	private estimateCells = new Map<string, EstimateCell>();
	private storeUnsub: (() => void) | null = null;
	private todayUnsub: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: InvestmentPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return FUND_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '基金汇总';
	}

	getIcon(): string {
		return 'chart-line';
	}

	get hasRendered(): boolean {
		return this.rendered;
	}

	async onOpen(): Promise<void> {
		this.rendered = true;
		this.subscribe();
		// 用当前快照立即渲染，并触发一次全量刷新让数据流补充新鲜数据
		this.renderSnapshot(this.plugin.store.snapshot);
		void this.plugin.store.refresh();
	}

	async onClose(): Promise<void> {
		if (this.storeUnsub) {
			this.storeUnsub();
			this.storeUnsub = null;
		}
		if (this.todayUnsub) {
			this.todayUnsub();
			this.todayUnsub = null;
		}
	}

	/** 由 main 触发重绘（ribbon、数据变更等入口）：仅要求数据流刷新，渲染由订阅驱动 */
	refresh(): void {
		void this.plugin.store.refresh();
	}

	private subscribe(): void {
		if (this.storeUnsub) return;
		this.storeUnsub = this.plugin.store.subscribe((s) => this.renderSnapshot(s));
	}

	/** 失败清单交互：打开对应笔记 / 重新加载（再走一次数据中枢全量刷新） */
	private failureHandlers(): FundFailureHandlers {
		return {
			onOpen: (f) => openTradeNote(this.app, this.plugin.settings.openFundInEdit, f.filePath),
			onRetry: () => void this.plugin.store.refresh(),
		};
	}

	private renderSnapshot(s: StoreSnapshot): void {
		// 盘中估值刷新：只原地更新各卡片估值单元格，避免整卡重绘闪烁
		if (s.change === 'estimate') {
			this.updateEstimateCells(s.estimates);
			return;
		}
		this.rebuild(s);
	}

	private rebuild(s: StoreSnapshot): void {
		const el = this.contentEl;
		el.empty();
		this.estimateCells.clear();
		if (this.todayUnsub) {
			this.todayUnsub();
			this.todayUnsub = null;
		}

		if (s.cards.length === 0) {
			const hasStock = s.overview.stockCount > 0 || s.overview.unpricedStockCount > 0;
			if (!hasStock) {
				if (s.error) {
					el.createEl('p', { text: `基金汇总失败：${s.error}`, cls: 'inv-hint' });
				} else if (s.failedFunds.length > 0) {
					renderFundFailureNotice(
						el,
						s.failedFunds,
						this.failureHandlers(),
						'请检查网络或笔记中的基金代码',
					);
				} else {
					el.createEl('p', {
						text: '还没有任何基金持仓。右键文件夹 →「添加基金」创建，或在基金笔记中加仓/减仓后，这里会自动汇总。',
						cls: 'inv-hint',
					});
				}
				return;
			}
		}

		const summaryRefs = renderSummaryCard(el, s.overview, s.failedFunds, this.failureHandlers());
		if (summaryRefs.today) {
			this.todayUnsub = this.plugin.store.todayMonitor.register({
				valueEl: summaryRefs.today,
				labelEl: summaryRefs.label ?? undefined,
				rateEl: summaryRefs.rate ?? undefined,
			});
		}

		// 只有股票、没有基金：汇总卡已覆盖股票市值，列表区直接展示股票卡片
		const list = el.createDiv({ cls: 'inv-fund-list' });
		for (const card of s.cards) {
			list.appendChild(this.buildFundCard(card, s.estimates.get(card.code)));
		}
		for (const stock of s.stocks) {
			list.appendChild(this.buildStockCard(stock));
		}
	}

	private buildFundCard(card: FundCard, estimate?: RealtimeEstimate): HTMLElement {
		const root = this.contentEl.ownerDocument.createElement('div');
		root.className = 'inv-fund-card';
		root.addEventListener('click', () => {
			openTradeNote(this.app, this.plugin.settings.openFundInEdit, card.filePath);
		});

		const top = root.createDiv({ cls: 'inv-fund-card-top' });
		const info = top.createDiv({ cls: 'inv-fund-card-info' });
		info.createDiv({ text: card.name, cls: 'inv-fund-card-name' });
		const codeRow = info.createDiv({ cls: 'inv-fund-card-code' });
		codeRow.createSpan({ text: card.code });
		codeRow.createSpan({ text: fmtMoney(card.holdAmount), cls: 'inv-fund-card-held' });
		// 今日买卖信号徽标；已处理（确认/忽略）则淡化显示；skipTradeNotify 的基金不提醒故不显示
		if (card.signal && !card.skipTradeNotify) {
			const handled = this.plugin.getSignalStatus(card.code) != null;
			const chip = info.createSpan({
				cls: `inv-fund-card-signal ${card.signal.type}${handled ? ' handled' : ''}`,
				text: card.signal.type === 'buy' ? '买入信号' : '卖出信号',
			});
			chip.setAttribute(
				'title',
				`${card.signal.type === 'buy' ? '买入' : '卖出'}信号${handled ? '（已处理）' : ''}，点击卡片查看`,
			);
		}
		if (card.sparkline.length >= 2) {
			top.appendChild(this.microSparkline(card.sparkline));
		}

		const stats = root.createDiv({ cls: 'inv-fund-card-stats' });

		const change = stats.createDiv({ cls: 'inv-fund-card-cell' });
		const changeLabel = change.createDiv({
			text: estimate ? '盘中估值' : card.navDate ? card.navDate.slice(5) : '昨收',
			cls: 'inv-fund-card-label',
		});
		const changeVal = change.createDiv({
			text: estimate ? fmtPercent(estimate.gszzl / 100, 2, true) : fmtPercent(card.todayChange, 2, true),
			cls: 'inv-fund-card-value',
		});
		changeVal.style.color = profitColor(estimate ? estimate.gszzl : card.todayChange);
		const changeSub = change.createDiv({
			text: estimate ? `${estimate.gsz.toFixed(4)} ${estimate.gztime}` : '',
			cls: 'inv-fund-card-label',
		});

		const earn = stats.createDiv({ cls: 'inv-fund-card-cell' });
		earn.createDiv({ text: '收益', cls: 'inv-fund-card-label' });
		const profitVal = earn.createDiv({ text: fmtSignedMoney(card.totalProfit), cls: 'inv-fund-card-value' });
		profitVal.style.color = profitColor(card.totalProfit);

		const annual = stats.createDiv({ cls: 'inv-fund-card-cell' });
		annual.createDiv({ text: '年化', cls: 'inv-fund-card-label' });
		const annualVal = annual.createDiv({ text: fmtPercent(card.annual, 2, true), cls: 'inv-fund-card-value' });
		annualVal.style.color = profitColor(card.annual);

		this.estimateCells.set(card.code, { label: changeLabel, value: changeVal, sub: changeSub });

		return root;
	}

	/** 股票卡片：与基金卡片同构，展示最新价 / 收益 / 收益率，点击打开股票笔记 */
	private buildStockCard(stock: StockCard): HTMLElement {
		const root = this.contentEl.ownerDocument.createElement('div');
		root.className = 'inv-fund-card';
		root.addEventListener('click', () => {
			openTradeNote(this.app, this.plugin.settings.openFundInEdit, stock.filePath);
		});

		const top = root.createDiv({ cls: 'inv-fund-card-top' });
		const info = top.createDiv({ cls: 'inv-fund-card-info' });
		info.createDiv({ text: stock.name, cls: 'inv-fund-card-name' });
		const codeRow = info.createDiv({ cls: 'inv-fund-card-code' });
		codeRow.createSpan({ text: stock.code });
		codeRow.createSpan({ text: fmtMoney(stock.holdAmount), cls: 'inv-fund-card-held' });

		const stats = root.createDiv({ cls: 'inv-fund-card-stats' });

		const price = stats.createDiv({ cls: 'inv-fund-card-cell' });
		price.createDiv({ text: '最新价', cls: 'inv-fund-card-label' });
		const priceVal = price.createDiv({
			text: stock.price != null ? fmtMoney(stock.price) : '—',
			cls: 'inv-fund-card-value',
		});
		if (stock.changePercent != null) priceVal.style.color = profitColor(stock.changePercent);
		price.createDiv({
			text:
				stock.changePercent != null
					? fmtPercent(stock.changePercent / 100, 2, true)
					: '已清仓',
			cls: 'inv-fund-card-label',
		});

		const earn = stats.createDiv({ cls: 'inv-fund-card-cell' });
		earn.createDiv({ text: '收益', cls: 'inv-fund-card-label' });
		const profitVal = earn.createDiv({ text: fmtSignedMoney(stock.totalProfit), cls: 'inv-fund-card-value' });
		profitVal.style.color = profitColor(stock.totalProfit);

		const rate = stats.createDiv({ cls: 'inv-fund-card-cell' });
		rate.createDiv({ text: '收益率', cls: 'inv-fund-card-label' });
		const rateVal = rate.createDiv({
			text: fmtPercent(stock.totalProfitRate, 2, true),
			cls: 'inv-fund-card-value',
		});
		rateVal.style.color = profitColor(stock.totalProfitRate);

		return root;
	}

	/** 迷你 SVG 走势线（对齐移动端 sparkline） */
	private microSparkline(points: number[]): SVGSVGElement {
		const svg = this.contentEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '64');
		svg.setAttribute('height', '28');
		svg.setAttribute('viewBox', '0 0 64 28');
		svg.classList.add('inv-fund-card-spark');

		const min = Math.min(...points);
		const max = Math.max(...points);
		const range = max - min || 1;
		const up = points[points.length - 1]! >= points[0]!;
		const color = up ? 'var(--text-success)' : 'var(--text-error)';

		const d = points
			.map((p, i) => {
				const x = (i / (points.length - 1)) * 64;
				const y = 28 - ((p - min) / range) * 26 - 1;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');

		const path = this.contentEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', color);
		path.setAttribute('stroke-width', '1.5');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(path);
		return svg;
	}

	/** 用数据流已缓存的估值原地更新各卡片估值单元格 */
	private updateEstimateCells(estimates: Map<string, RealtimeEstimate>): void {
		for (const [code, est] of estimates) {
			const cell = this.estimateCells.get(code);
			if (!cell) continue;
			cell.label.textContent = '盘中估值';
			cell.value.textContent = fmtPercent(est.gszzl / 100, 2, true);
			cell.value.style.color = profitColor(est.gszzl);
			cell.sub.textContent = `${est.gsz.toFixed(4)} ${est.gztime}`;
		}
	}
}