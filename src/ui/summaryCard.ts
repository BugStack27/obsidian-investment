import type { PortfolioOverview } from '../services/portfolioOverview';
import type { FundLoadFailure } from '../services/fundAnalysis';
import { todayProfitDateLabel } from '../services/portfolioOverview';
import { fmtMoney, fmtPercent, fmtSignedMoney, profitColor } from '../utils/format';
import { renderFundFailureLine, type FundFailureHandlers } from './fundFailureNotice';

/**
 * 所有基金顶部的汇总卡片（样式对齐 invest-app 移动端"总资产"卡片）：
 * 第一行标题"总资产"，第二行总资产大字 + 今日盈亏，第三行累计收益 + 年化 + 基金数。
 * 总资产与累计收益含股票持仓；今日盈亏与年化仍只统计基金，有股票时在卡底注明口径。
 * 今日盈亏前的日期标签随行情日期变化（当日为「今日」，净值口径回退时为 `MM-DD`）。
 * 有加载失败的基金时，底部追加一行「N 只基金未纳入统计」（悬浮名单、点击菜单、可重新加载）。
 * 返回今日盈亏的标签 / 金额 / 涨跌幅元素引用，供实时估值定时刷新时原地更新。
 */
export function renderSummaryCard(
	el: HTMLElement,
	ov: PortfolioOverview,
	failures: FundLoadFailure[],
	handlers: FundFailureHandlers,
): { label: HTMLElement | null; today: HTMLElement | null; rate: HTMLElement | null } {
	const card = el.createDiv({ cls: 'inv-fund-summary' });

	const top = card.createDiv({ cls: 'inv-fund-summary-top' });
	top.createDiv({ text: '总资产', cls: 'inv-fund-summary-title' });

	const assetsRow = card.createDiv({ cls: 'inv-fund-summary-assets' });
	assetsRow.createSpan({ text: fmtMoney(ov.totalAssets), cls: 'inv-fund-summary-total' });
	let labelEl: HTMLElement | null = null;
	let todayEl: HTMLElement | null = null;
	let rateEl: HTMLElement | null = null;
	const hasFunds = ov.fundCount > 0;
	if (hasFunds) {
		// 标签与金额同组，保证二者间距紧于与其他元素的间距
		const group = assetsRow.createSpan({ cls: 'inv-fund-summary-today-group' });
		labelEl = group.createSpan({
			text: todayProfitDateLabel(ov.todayProfitDate),
			cls: 'inv-fund-summary-label',
		});
		todayEl = group.createSpan({
			text: fmtSignedMoney(ov.todayProfit),
			cls: 'inv-fund-summary-today',
		});
		todayEl.style.color = profitColor(ov.todayProfit);
		// 涨跌幅分母保持基金口径：总资产已含股票，直接相减会把股票市值带进分母
		const prevAssets = ov.fundAssets - ov.todayProfit;
		if (Number.isFinite(prevAssets) && prevAssets > 0) {
			const rate = ov.todayProfit / prevAssets;
			rateEl = group.createSpan({
				text: `(${fmtPercent(rate, 2, true)})`,
				cls: 'inv-fund-summary-rate',
			});
			rateEl.style.color = profitColor(ov.todayProfit);
		}
	}

	const foot = card.createDiv({ cls: 'inv-fund-summary-foot' });
	const profit = foot.createSpan({
		text: `累计收益 ${fmtSignedMoney(ov.totalProfit)}`,
		cls: 'inv-fund-summary-text',
	});
	profit.style.color = profitColor(ov.totalProfit);
	const ann = foot.createSpan({
		text: hasFunds ? `年化 ${fmtPercent(ov.annualized, 2, true)}` : '年化 —',
		cls: 'inv-fund-summary-rate',
	});
	if (hasFunds) ann.style.color = profitColor(ov.annualized);
	foot.createSpan({
		text:
			ov.stockCount > 0
				? `基金 ${ov.fundCount} 只 · 股票 ${ov.stockCount} 只`
				: `共 ${ov.fundCount} 只`,
		cls: 'inv-fund-summary-text',
	});

	// 含股票时注明口径，避免「年化/今日」被误读为覆盖全部持仓
	if (ov.stockCount > 0 || ov.unpricedStockCount > 0) {
		const notes = card.createDiv({ cls: 'inv-fund-summary-notes' });
		notes.createDiv({
			text: '总资产与累计收益含股票；今日盈亏与年化仅统计基金',
			cls: 'inv-fund-summary-note',
		});
		if (ov.unpricedStockCount > 0) {
			notes.createDiv({
				text: `${ov.unpricedStockCount} 只股票无行情，未纳入统计`,
				cls: 'inv-fund-summary-note is-warning',
			});
		}
	}

	if (failures.length > 0) {
		renderFundFailureLine(card.createDiv({ cls: 'inv-fund-failures' }), failures, handlers, true);
	}

	return { label: labelEl, today: todayEl, rate: rateEl };
}