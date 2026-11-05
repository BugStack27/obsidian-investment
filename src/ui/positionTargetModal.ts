import { App, Modal, Notice } from 'obsidian';
import { collectPositionTargets, type PositionTarget } from '../services/positionTargets';

/**
 * 标的选择弹窗：列出全库基金/股票笔记（分组 + 关键词本地过滤），点击带回所选标的。
 * 由统一加减仓弹窗在目标未锁定时打开；数据来自 `collectPositionTargets`（纯本地扫描）。
 */
export class PositionTargetModal extends Modal {
	private readonly onPick: (target: PositionTarget) => void;
	private funds: PositionTarget[] = [];
	private stocks: PositionTarget[] = [];
	private listEl: HTMLElement | null = null;
	private inputEl: HTMLInputElement | null = null;
	private loaded = false;

	constructor(app: App, onPick: (target: PositionTarget) => void) {
		super(app);
		this.onPick = onPick;
	}

	onOpen(): void {
		this.modalEl.addClass('inv-position-picker-modal');
		this.setTitle('选择基金/股票');
		const { contentEl } = this;

		this.inputEl = contentEl.createEl('input', {
			cls: 'inv-search-input',
			attr: { type: 'text', placeholder: '输入代码或名称过滤', spellcheck: 'false' },
		});
		this.inputEl.addEventListener('input', () => this.render(this.currentFilter()));

		this.listEl = contentEl.createDiv({ cls: 'inv-search-results' });
		this.listEl.createDiv({ text: '加载中…', cls: 'inv-hint' });
		void this.load();
	}

	private currentFilter(): string {
		return this.inputEl?.value.trim().toLowerCase() ?? '';
	}

	private async load(): Promise<void> {
		try {
			const { funds, stocks } = await collectPositionTargets(this.app);
			if (!this.listEl?.isConnected) return;
			this.funds = funds;
			this.stocks = stocks;
			this.loaded = true;
			// 加载期间用户可能已输入过滤词：按当前输入值渲染，不丢过滤
			this.render(this.currentFilter());
		} catch (e) {
			if (!this.listEl?.isConnected) return;
			new Notice(`加载标的失败：${e instanceof Error ? e.message : String(e)}`);
			this.listEl.empty();
			this.listEl.createDiv({ text: '加载失败，请关闭后重试', cls: 'inv-hint' });
		}
	}

	/** 本地过滤（不重新扫库）：匹配 name/code 子串（大小写不敏感），保持基金/股票分组结构 */
	private render(filter: string): void {
		const list = this.listEl;
		if (!list || !this.loaded) return;
		list.empty();

		const match = (t: PositionTarget): boolean =>
			!filter || t.name.toLowerCase().includes(filter) || t.code.toLowerCase().includes(filter);
		const funds = this.funds.filter(match);
		const stocks = this.stocks.filter(match);

		if (funds.length === 0 && stocks.length === 0) {
			list.createDiv({
				text:
					this.funds.length + this.stocks.length === 0
						? '未找到基金/股票笔记，请先添加'
						: '无匹配标的',
				cls: 'inv-hint',
			});
			return;
		}

		this.renderGroup(list, '基金', funds);
		this.renderGroup(list, '股票', stocks);
	}

	private renderGroup(parent: HTMLElement, label: string, items: PositionTarget[]): void {
		if (items.length === 0) return;
		parent.createDiv({ cls: 'inv-picker-group', text: label });
		for (const t of items) {
			const row = parent.createDiv({ cls: 'inv-search-row' });
			row.createSpan({ text: t.name, cls: 'inv-search-name' });
			row.createSpan({ text: t.code, cls: 'inv-search-code' });
			row.createSpan({
				text: label,
				cls: `inv-picker-kind ${t.kind === 'fund' ? 'is-fund' : 'is-stock'}`,
			});
			row.addEventListener('click', () => {
				this.onPick(t);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.listEl = null;
		this.inputEl = null;
	}
}
