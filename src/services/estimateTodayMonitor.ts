import type { RealtimeEstimate } from './realtimeEstimate';
import {
	TODAY_PROFIT_TODAY_LABEL,
	summarizeFundCards,
	sumEstimatedTodayProfit,
	type FundCard,
} from './portfolioOverview';
import { fmtPercent, fmtSignedMoney, profitColor } from '../utils/format';

/** 一个"今日盈亏"输出位：金额元素必填，可选同时刷新日期标签与相对昨日资产的涨跌幅元素 */
export interface TodayProfitTarget {
	/** 金额元素（如 ¥+1,234.56） */
	valueEl: HTMLElement;
	/** 可选：行情日期标签元素（「今日」/`MM-DD`），随口径切换原地更新 */
	labelEl?: HTMLElement | null;
	/** 可选：涨跌幅元素，显示为 `(±x.xx%)` */
	rateEl?: HTMLElement;
}

/**
 * 今日盈亏（估值口径：持有金额 × 估算涨跌幅 / 100）的纯输出位集合。
 * 只负责把已结算的"今日"值原地写入各组输出位，不主动拉取数据——盘中估值由数据流中枢统一缓存并驱动，
 * 每次拿到同一份估值即可同时更新状态栏与侧栏汇总卡，避免各视图重复计算/请求。
 */
export class EstimateTodayMonitor {
	private cards: FundCard[] = [];
	private targets = new Set<TodayProfitTarget>();

	setCards(cards: FundCard[]): void {
		this.cards = cards;
	}

	/** 挂载一个输出位；返回移动时用于注销的函数 */
	register(target: TodayProfitTarget): () => void {
		this.targets.add(target);
		return () => {
			this.targets.delete(target);
		};
	}

	/**
	 * 用数据流已缓存的估值统一更新所有输出位；今日估值无效时不写入
	 * （此时保持 refresh 写入的净值口径数值与对应日期标签）。
	 * 估值有效 ⇒ 行情日期为当日 ⇒ 标签恒为「今日」。
	 */
	render(estimates: Map<string, RealtimeEstimate>): void {
		if (this.cards.length === 0 || this.targets.size === 0) return;
		const estToday = sumEstimatedTodayProfit(this.cards, estimates);
		if (estToday === null) return;
		const prevAssets = summarizeFundCards(this.cards).totalAssets - estToday;
		for (const t of this.targets) {
			if (t.labelEl) t.labelEl.textContent = TODAY_PROFIT_TODAY_LABEL;
			t.valueEl.textContent = fmtSignedMoney(estToday);
			t.valueEl.style.color = profitColor(estToday);
			if (t.rateEl && Number.isFinite(prevAssets) && prevAssets > 0) {
				t.rateEl.textContent = `(${fmtPercent(estToday / prevAssets, 2, true)})`;
				t.rateEl.style.color = profitColor(estToday);
			}
		}
	}
}