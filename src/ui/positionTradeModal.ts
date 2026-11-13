import { Modal, Notice, Setting } from 'obsidian';
import type InvestmentPlugin from '../main';
import type { Transaction, TxType } from '../types';
import type { PositionTarget } from '../services/positionTargets';
import { fetchStockQuote } from '../services/stockSdk';
import { todayEstimateNav } from '../utils/estimateNav';
import { isValidRecordDate, normalizeRecordDate, todayStr } from '../utils/recordDate';
import { fmtMoney, fmtShares } from '../utils/format';
import { PositionTargetModal } from './positionTargetModal';

/** 统一加减仓弹窗的初始化参数 */
export interface PositionTradeInit {
	/** 预选目标；`targetLocked` 为 true 时不可改选（笔记按钮 / 买卖信号 / 编辑场景） */
	target?: PositionTarget;
	targetLocked?: boolean;
	/** 预选类型；`typeLocked` 为 true 时不可改选（编辑场景） */
	type?: TxType;
	typeLocked?: boolean;
	date?: string;
	amount?: number;
	shares?: number;
	/** 股票预填成交价（调用方已持有行情或编辑场景）；未提供且选中股票时异步拉行情预填 */
	price?: number;
	fee?: number;
	note?: string;
	/** 卖出可卖份额解析：用于展示上限与超限拦截；返回 null 表示无法判定（不拦截） */
	resolveAvailableShares?: (target: PositionTarget) => Promise<number | null>;
}

const KIND_LABEL: Record<PositionTarget['kind'], string> = { fund: '基金', stock: '股票' };

/**
 * 统一加减仓弹窗：新增「加减仓」命令、笔记按钮、买卖信号确认、表格行编辑的共同入口。
 * - 目标：未锁定时经 `PositionTargetModal` 从全库基金/股票笔记中选择；锁定时静态展示；
 * - 类型：买入（加仓）/ 卖出（减仓）/ 分红（现金到账，基金与股票目标均可）；
 * - 字段组按目标 kind 与类型切换：基金 = 金额 + 份额（分红只填金额）；股票 = 数量 + 价格（分红只填金额）；
 * - 基金卖出时按当日估值（缺失时回退最新净值）实时预估到账金额；
 * - 保存经 `onSave(tx, target)` 交回调用方写盘（新增 = 追加记录行，编辑 = 替换该行）；
 *   返回的 Promise 代表写回完成，失败须 reject——「保存并继续」只在写回成功后清空表单。
 */
export class PositionTradeModal extends Modal {
	private readonly plugin: InvestmentPlugin;
	private readonly onSave: (tx: Transaction, target: PositionTarget) => void | Promise<void>;
	private readonly resolveAvailable: PositionTradeInit['resolveAvailableShares'];

	/** 写回进行中：禁用表单，避免重复提交或清空时抹掉用户刚输入的内容 */
	private saving = false;
	/** 行情预填序号：连续录入清空表单后让在途的预填失效，避免旧价格回填 */
	private priceSeq = 0;

	private target: PositionTarget | null;
	private readonly targetLocked: boolean;
	private type: TxType;
	private readonly typeLocked: boolean;
	private date: string;
	private amount = 0;
	private shares = 0;
	private price = 0;
	private fee = 0;
	private note = '';
	/** 价格是否已被用户改过（或由 init 预填）：未改过才在选中股票时用行情价预填 */
	private priceTouched: boolean;
	/** 股票价格输入框引用：行情预填到达时原地更新，避免整表重建 */
	private priceInput: HTMLInputElement | null = null;

	/** 可卖份额：'idle' = 非卖出或未提供解析（不展示不校验），'loading' 解析中 */
	private available: number | null | 'idle' | 'loading' = 'idle';
	/** 解析序号：目标/类型变化后丢弃过期结果 */
	private availableSeq = 0;
	/** 份额/数量输入项下方的提示元素，解析完成后原地更新，避免整表重建打断输入 */
	private sharesHintEl: HTMLElement | null = null;

	/** 基金卖出预估净值（当日估值优先；缺失时为最新官方净值） */
	private nav: { nav: number; date: string; estimated: boolean } | null = null;
	/** 净值解析序号：目标变化后丢弃过期结果 */
	private navSeq = 0;
	/** 数据中枢订阅：盘中估值刷新时同步更新预估金额 */
	private navUnsub: (() => void) | null = null;
	/** 卖出「预估到账」提示元素，份额/日期/估值变化时原地更新 */
	private sellAmountEl: HTMLElement | null = null;

	private targetRowEl: HTMLElement | null = null;
	private formEl: HTMLElement | null = null;

	constructor(
		plugin: InvestmentPlugin,
		init: PositionTradeInit,
		onSave: (tx: Transaction, target: PositionTarget) => void | Promise<void>,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.onSave = onSave;
		this.resolveAvailable = init.resolveAvailableShares;
		this.target = init.target ?? null;
		this.targetLocked = init.targetLocked ?? false;
		this.type = init.type ?? 'buy';
		this.typeLocked = init.typeLocked ?? false;
		// 归一化后再进控件：date 控件对 '2026-7-8' 会静默清空，直接赋值等于把原日期抹掉
		this.date = normalizeRecordDate(init.date) ?? todayStr();
		this.amount = init.amount ?? 0;
		this.shares = init.shares ?? 0;
		this.price = init.price ?? 0;
		this.fee = init.fee ?? 0;
		this.note = init.note ?? '';
		this.priceTouched = (init.price ?? 0) > 0;
	}

	onOpen(): void {
		this.modalEl.addClass('inv-position-modal');
		const { contentEl } = this;
		this.targetRowEl = contentEl.createDiv({ cls: 'inv-position-target-row' });
		this.formEl = contentEl.createDiv({ cls: 'inv-position-form' });
		this.renderAll();
		this.refreshAvailable();
		void this.refreshNav();
		// 盘中估值每 60s 刷新一次：订阅数据中枢，让预估金额跟随最新估值
		this.navUnsub = this.plugin.store.subscribe((s) => {
			if (s.change === 'estimate' || s.change === 'full') void this.refreshNav();
		});
		// 命令等场景预选股票但无预填价：异步拉一次行情补默认成交价（失败静默留空）；分红只填金额，不预填价格
		if (this.target && this.target.kind === 'stock' && this.type !== 'dividend' && !this.priceTouched) {
			void this.prefillPrice(this.target);
		}
	}

	onClose(): void {
		this.navUnsub?.();
		this.navUnsub = null;
		this.nav = null;
		this.contentEl.empty();
		this.targetRowEl = null;
		this.formEl = null;
		this.priceInput = null;
		this.sharesHintEl = null;
		this.sellAmountEl = null;
	}

	private titleText(): string {
		if (this.typeLocked) return '编辑记录';
		if (this.type === 'buy') return '加仓记录';
		if (this.type === 'sell') return '减仓记录';
		return '分红记录';
	}

	private renderAll(): void {
		this.renderTargetRow();
		this.renderForm();
		this.setTitle(this.titleText());
	}

	// ---------- 目标行 ----------

	private renderTargetRow(): void {
		const row = this.targetRowEl;
		if (!row) return;
		row.empty();
		row.createSpan({ cls: 'inv-position-target-label', text: '标的' });
		const body = row.createDiv({ cls: 'inv-position-target-body' });

		if (this.target) {
			body.createSpan({
				cls: `inv-picker-kind ${this.target.kind === 'fund' ? 'is-fund' : 'is-stock'}`,
				text: KIND_LABEL[this.target.kind],
			});
			body.createSpan({ cls: 'inv-position-target-name', text: this.target.name });
			body.createSpan({ cls: 'inv-position-target-code', text: this.target.code });
			if (!this.targetLocked) {
				const change = body.createEl('button', {
					cls: 'inv-position-target-change',
					text: '更改',
					attr: { type: 'button' },
				});
				change.addEventListener('click', () => this.openPicker());
			}
		} else if (this.targetLocked) {
			body.createSpan({ cls: 'inv-hint', text: '未选择标的' });
		} else {
			const pick = body.createEl('button', {
				cls: 'inv-btn',
				text: '选择基金/股票',
				attr: { type: 'button' },
			});
			pick.addEventListener('click', () => this.openPicker());
		}
	}

	private openPicker(): void {
		new PositionTargetModal(this.app, (t) => {
			// kind 变化时字段组与标题随 renderAll 重建
			const prevKind = this.target?.kind;
			this.target = t;
			// 目标换了，旧标的的净值不能继续用于预估；等 refreshNav 重新解析
			this.nav = null;
			if (t.kind === 'stock' && this.type !== 'dividend' && !this.priceTouched) {
				// 切到新股标：重新预填行情价（未手动改过才填）
				void this.prefillPrice(t);
			} else if (prevKind === 'stock' && t.kind === 'fund') {
				this.price = 0;
			}
			this.renderAll();
			this.refreshAvailable();
			void this.refreshNav();
		}).open();
	}

	/** 拉取股票最新价预填成交价（60s 缓存）；目标已切换或用户已手输时放弃 */
	private async prefillPrice(t: PositionTarget): Promise<void> {
		const seq = ++this.priceSeq;
		try {
			const quote = await fetchStockQuote(t.code);
			if (seq !== this.priceSeq || this.target !== t || this.priceTouched) return;
			if (quote && quote.price > 0) {
				this.price = quote.price;
				if (this.priceInput) this.priceInput.value = String(quote.price);
			}
		} catch {
			// 行情不可得时留空，由用户手填
		}
	}

	// ---------- 卖出预估金额 ----------

	/** 解析预估净值：当日实时估值优先；无当日估值（盘前 / 非交易时段）回退最新官方净值 */
	private async refreshNav(): Promise<void> {
		const seq = ++this.navSeq;
		const target = this.target;
		if (!target || target.kind !== 'fund') {
			this.nav = null;
			this.updateSellAmount();
			this.updateSharesHint();
			return;
		}
		const est = todayEstimateNav(this.plugin.store.snapshot.estimates, target.code);
		if (est) {
			this.nav = { nav: est.nav, date: est.date, estimated: true };
			this.updateSellAmount();
			this.updateSharesHint();
			return;
		}
		let latest: { nav: number; date: string } | null = null;
		try {
			const history = await this.plugin.store.nav(target.code);
			const last = history[history.length - 1];
			if (last) latest = { nav: last.netWorth, date: last.date };
		} catch {
			latest = null;
		}
		if (seq !== this.navSeq) return;
		this.nav = latest ? { ...latest, estimated: false } : null;
		this.updateSellAmount();
		this.updateSharesHint();
	}

	private updateSellAmount(): void {
		this.sellAmountEl?.setText(this.sellAmountText());
	}

	private sellAmountText(): string {
		if (this.type !== 'sell' || this.target?.kind !== 'fund') return '';
		// 预估只服务于当日成交：补录历史日期时成交净值已确定，当前估值没有参考意义
		if (this.date !== todayStr() || !this.nav) return '实际到账金额按份额 × 当日净值计算';
		const price = this.nav.estimated
			? `按当前估值 ${this.nav.nav.toFixed(4)}`
			: `按最新净值 ${this.nav.nav.toFixed(4)}（${this.nav.date.slice(5)}）`;
		if (this.shares <= 0) return `${price} 预估到账金额`;
		return `预估到账 ${fmtMoney(this.shares * this.nav.nav)}（${price}）`;
	}

	// ---------- 可卖份额 ----------

	/** 目标/类型变化后重新解析可卖份额；非卖出场景置回 idle（不提示不校验） */
	private refreshAvailable(): void {
		const seq = ++this.availableSeq;
		if (this.type !== 'sell' || !this.target || !this.resolveAvailable) {
			this.available = 'idle';
			this.updateSharesHint();
			return;
		}
		const target = this.target;
		this.available = 'loading';
		this.updateSharesHint();
		void this.resolveAvailable(target)
			.catch(() => null)
			.then((v) => {
				if (seq !== this.availableSeq || target !== this.target || this.type !== 'sell') return;
				this.available = v;
				this.updateSharesHint();
			});
	}

	/** 原地更新输入项下方的提示，避免异步结果到达时整表重建打断用户输入 */
	private updateSharesHint(): void {
		this.sharesHintEl?.setText(this.sharesHintText());
	}

	/** 份额/数量下方的提示：卖出显示可卖份额，买入显示按净值预估的另一字段 */
	private sharesHintText(): string {
		if (this.type === 'sell') return this.availableHintText();
		if (this.type === 'buy') return this.buyPreviewText();
		return '';
	}

	/**
	 * 基金买入预估：只填金额，份额由净值推导。
	 * 编辑已有记录时份额已随记录存在（输入框隐藏），保存时原样保留，不按金额改写。
	 */
	private buyPreviewText(): string {
		if (this.target?.kind !== 'fund') return '';
		if (this.shares > 0) return `已记录份额 ${fmtShares(this.shares)} 份（保存时保持不变）`;
		if (this.amount <= 0) return '份额将按记录日净值自动计算（金额 ÷ 净值）';
		const nav = this.nav;
		if (this.date !== todayStr() || !nav) return '份额将按记录日净值自动计算（金额 ÷ 净值）';
		const price = nav.estimated
			? `按当前估值 ${nav.nav.toFixed(4)}`
			: `按最新净值 ${nav.nav.toFixed(4)}（${nav.date.slice(5)}）`;
		return `预估 ${fmtShares(this.amount / nav.nav, 4)} 份（${price}，以确认净值为准）`;
	}

	private availableHintText(): string {
		if (this.type !== 'sell' || !this.target) return '';
		if (this.available === 'loading') return '正在读取当前可卖份额…';
		if (this.available === null) return '无法获取当前可卖份额，本次不校验上限';
		if (typeof this.available !== 'number') return '';
		return `当前可卖 ${this.formatAvailable(this.available)}`;
	}

	/** 基金份额可到小数点后多位，按 4 位展示；展示值向下取整，避免四舍五入后照抄显示值反被判超限 */
	private formatAvailable(v: number): string {
		const digits = this.target?.kind === 'stock' ? 2 : 4;
		const scale = 10 ** digits;
		const shown = Math.floor(v * scale) / scale;
		return `${fmtShares(shown, digits)} ${this.availableUnit()}`;
	}

	private availableUnit(): string {
		return this.target?.kind === 'stock' ? '股' : '份';
	}

	// ---------- 表单 ----------

	private renderForm(): void {
		const form = this.formEl;
		if (!form) return;
		form.empty();
		this.priceInput = null;
		this.sharesHintEl = null;
		this.sellAmountEl = null;

		const isStock = this.target?.kind === 'stock';
		const allowDividend = this.target != null;

		// 类型：编辑场景锁定为静态文本；否则下拉（选中目标后均可选分红）
		if (this.typeLocked) {
			const label =
				this.type === 'buy' ? '买入（加仓）' : this.type === 'sell' ? '卖出（减仓）' : '分红（现金到账）';
			new Setting(form).setName('类型').setDesc(label);
		} else {
			new Setting(form).setName('类型').addDropdown((dd) => {
				dd.addOption('buy', '买入（加仓）').addOption('sell', '卖出（减仓）');
				if (allowDividend) dd.addOption('dividend', '分红（现金到账）');
				dd.setValue(this.type).onChange((v) => {
					this.type = v as TxType;
					// 切换类型时清空对立字段，降低误填（沿用旧弹窗策略）
					if (v === 'buy') this.shares = 0;
					else if (v === 'sell') this.amount = 0;
					else this.shares = 0;
					this.renderForm();
					this.setTitle(this.titleText());
					this.refreshAvailable();
				});
			});
		}

		// 原生日期控件：value 恒为 YYYY-MM-DD 或空串，不再有格式错的可能；不限制未来日期（可预录挂单成交）
		new Setting(form).setName('日期').addText((text) => {
			text.inputEl.type = 'date';
			text.inputEl.addClass('inv-date-input');
			text.setValue(this.date).onChange((v) => {
				this.date = v.trim();
				this.updateSellAmount();
				this.updateSharesHint();
			});
		});

		// 分红只填金额：基金与股票同口径，不涉及数量与价格
		if (this.type === 'dividend') {
			new Setting(form).setName('金额（元）').addText((text) =>
				text
					.setPlaceholder('分红到账金额')
					.setValue(this.amount ? String(this.amount) : '')
					.onChange((v) => {
						this.amount = Number(v) || 0;
					}),
			);
		} else if (isStock) {
			const qtySetting = new Setting(form).setName('数量（股）').setDesc(this.sharesHintText());
			this.sharesHintEl = qtySetting.descEl;
			qtySetting.addText((text) =>
				text
					.setPlaceholder(this.type === 'buy' ? '买入股数' : '卖出股数')
					.setValue(this.shares ? String(this.shares) : '')
					.onChange((v) => {
						this.shares = Number(v) || 0;
					}),
			);
			new Setting(form).setName('价格（元）').addText((text) => {
				const el = text
					.setPlaceholder('成交价')
					.setValue(this.price ? String(this.price) : '')
					.onChange((v) => {
						this.price = Number(v) || 0;
						this.priceTouched = true;
					});
				this.priceInput = el.inputEl;
			});
		} else if (this.type === 'buy') {
			// 基金买入只填金额：份额按记录日净值在数据层推导，这里只按估值预估提示
			const amountSetting = new Setting(form).setName('金额（元）').setDesc(this.sharesHintText());
			this.sharesHintEl = amountSetting.descEl;
			amountSetting.addText((text) =>
				text
					.setPlaceholder('买入金额')
					.setValue(this.amount ? String(this.amount) : '')
					.onChange((v) => {
						this.amount = Number(v) || 0;
						this.updateSharesHint();
					}),
			);
		} else {
			// 卖出不允许手填金额：统一由「份额 × 当日净值」在数据层推导，校验口径只剩份额
			const sharesSetting = new Setting(form).setName('份额').setDesc(this.sharesHintText());
			this.sharesHintEl = sharesSetting.descEl;
			sharesSetting.addText((text) =>
				text
					.setPlaceholder('卖出份额')
					.setValue(this.shares ? String(this.shares) : '')
					.onChange((v) => {
						this.shares = Number(v) || 0;
						this.updateSellAmount();
						this.updateSharesHint();
					}),
			);
			this.sellAmountEl = form.createEl('p', { cls: 'inv-hint' });
			this.updateSellAmount();
		}

		new Setting(form).setName('手续费（元）').addText((text) =>
			text.setPlaceholder('0').setValue(this.fee ? String(this.fee) : '').onChange((v) => {
				this.fee = Number(v) || 0;
			}),
		);

		new Setting(form).setName('备注').addText((text) =>
			text.setPlaceholder('可选，不含逗号').setValue(this.note).onChange((v) => {
				this.note = v.trim();
			}),
		);

		const actions = new Setting(form);
		actions.settingEl.addClass('inv-position-actions');
		actions.addButton((btn) =>
			btn.setButtonText('保存').setCta().onClick(() => void this.save(false)),
		);
		// 编辑已有记录是「替换该行」，连续录入会变成重复替换，故只在新增场景提供
		if (!this.typeLocked) {
			actions.addButton((btn) =>
				btn.setButtonText('保存并继续').onClick(() => void this.save(true)),
			);
		}
	}

	/**
	 * 保存一条记录。`continueAfter` 为「保存并继续」：写回成功后清空录入内容，
	 * 保留日期 / 类型 / 标的，弹窗继续打开供录入下一条；写回失败一律保留现场。
	 */
	private async save(continueAfter: boolean): Promise<void> {
		if (this.saving) return;
		const target = this.target;
		if (!target) {
			new Notice('请先选择基金/股票');
			return;
		}
		if (!this.date) {
			new Notice('请选择日期');
			return;
		}
		// 兜底：控件被清空后若被塞入非规范值，宁可拦下也不写出一条下游读不到的记录
		if (!isValidRecordDate(this.date)) {
			new Notice('日期格式不正确，请重新选择日期');
			return;
		}
		if (this.type === 'dividend') {
			if (this.amount <= 0) {
				new Notice('请填写分红金额');
				return;
			}
		} else if (target.kind === 'stock') {
			if (this.shares <= 0 || this.price <= 0) {
				new Notice('请填写数量与价格');
				return;
			}
		} else if (this.type === 'sell') {
			if (this.shares <= 0) {
				new Notice('请填写卖出份额');
				return;
			}
		} else if (this.type === 'buy') {
			if (this.amount <= 0) {
				new Notice('请填写买入金额');
				return;
			}
		}

		if (this.type === 'sell') {
			if (this.available === 'loading') {
				new Notice('正在读取当前可卖份额，请稍候');
				return;
			}
			if (typeof this.available === 'number' && this.shares > this.available + 1e-6) {
				new Notice(`减仓份额超出当前可卖 ${this.formatAvailable(this.available)}，已拦截`);
				return;
			}
		}

		const tx: Transaction = {
			type: this.type,
			date: this.date,
			// 分红金额恒按录入值（股票分红没有数量与价格）；股票买入/卖出金额 = 数量 × 价格；
			// 基金买入按录入值（份额留空，由「金额 ÷ 净值」补全）；卖出金额留空，由「份额 × 当日净值」补全
			amount:
				this.type === 'dividend'
					? this.amount
					: target.kind === 'stock'
						? this.shares * this.price
						: this.type === 'sell'
							? 0
							: this.amount,
			shares: this.type === 'dividend' ? 0 : this.shares,
			fee: this.fee,
			note: this.note,
		};
		this.setSaving(true);
		try {
			// 等写回真正完成再决定「关闭」还是「清空继续」，避免写回失败时输入已丢失
			await this.onSave(tx, target);
		} catch {
			// 失败提示由调用方给出；保留输入与弹窗，便于重试
			return;
		} finally {
			this.setSaving(false);
		}
		if (continueAfter) {
			this.resetForNext(tx);
		} else {
			this.close();
		}
	}

	/** 写回期间禁用表单与改选标的按钮；弹窗关闭或表单重建后自然恢复 */
	private setSaving(busy: boolean): void {
		this.saving = busy;
		for (const root of [this.formEl, this.targetRowEl]) {
			root
				?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')
				.forEach((el) => {
					el.disabled = busy;
				});
		}
	}

	/** 连续录入：只清空录入值，日期 / 类型 / 标的保持不变 */
	private resetForNext(tx: Transaction): void {
		this.amount = 0;
		this.shares = 0;
		this.price = 0;
		this.fee = 0;
		this.note = '';
		this.priceTouched = false;
		this.priceSeq++; // 丢弃在途的行情预填，避免清空后旧价格回填
		// 刚卖出一笔后本地扣减可卖上限：调用方持有的是写回前的持仓快照，重新解析会拿回旧值
		if (tx.type === 'sell' && typeof this.available === 'number') {
			this.available = Math.max(0, this.available - tx.shares);
		}
		this.renderForm();
		this.formEl?.querySelector<HTMLInputElement>('input:not([type="date"])')?.focus();
	}
}
