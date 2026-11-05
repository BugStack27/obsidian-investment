import { App, Modal } from 'obsidian';

export interface SearchPick {
	code: string;
	name: string;
}

interface SearchModalOptions {
	title: string;
	placeholder: string;
	/** 按关键词异步搜索，返回 { code, name } 列表 */
	search: (keyword: string) => Promise<SearchPick[]>;
	onPick: (pick: SearchPick) => void;
}

/**
 * 通用搜索弹窗：输入关键词（代码/名称）→ 展示结果列表 → 点击带回所选标的。
 * 基金 / 股票搜索均复用此弹窗，仅搜索函数与文案不同。
 */
export class SearchModal extends Modal {
	private readonly opts: SearchModalOptions;
	private listEl: HTMLDivElement | null = null;
	private timer: number | null = null;
	private latestQuery = 0;

	constructor(app: App, opts: SearchModalOptions) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		this.setTitle(this.opts.title);
		const { contentEl } = this;

		const input = contentEl.createEl('input', {
			type: 'text',
			attr: { placeholder: this.opts.placeholder, class: 'inv-search-input' },
		});
		input.addEventListener('input', () => {
			const kw = input.value.trim();
			if (this.timer) window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => {
				void this.runSearch(kw);
			}, 300);
		});

		this.listEl = contentEl.createDiv({ cls: 'inv-search-results' });
		this.listEl.createDiv({ text: '输入关键词开始搜索', cls: 'inv-hint' });
	}

	private async runSearch(kw: string): Promise<void> {
		const q = ++this.latestQuery;
		if (!this.listEl) return;
		this.listEl.empty();
		if (!kw) {
			this.listEl.createDiv({ text: '请输入关键词', cls: 'inv-hint' });
			return;
		}
		this.listEl.createDiv({ text: '搜索中…', cls: 'inv-hint' });

		try {
			const items = await this.opts.search(kw);
			if (q !== this.latestQuery) return;
			this.listEl.empty();

			if (items.length === 0) {
				this.listEl.createDiv({ text: '未找到相关标的', cls: 'inv-hint' });
				return;
			}
			for (const it of items) {
				this.renderRow(it);
			}
		} catch (e) {
			if (q !== this.latestQuery) return;
			this.listEl.empty();
			this.listEl.createDiv({
				text: `搜索失败：${e instanceof Error ? e.message : String(e)}`,
				cls: 'inv-hint',
			});
		}
	}

	private renderRow(it: SearchPick): void {
		const row = this.listEl!.createDiv({ cls: 'inv-search-row' });
		row.createSpan({ text: it.name, cls: 'inv-search-name' });
		row.createSpan({ text: it.code, cls: 'inv-search-code' });
		row.addEventListener('click', () => {
			this.opts.onPick({ code: it.code, name: it.name });
			this.close();
		});
	}

	onClose(): void {
		if (this.timer) window.clearTimeout(this.timer);
		this.contentEl.empty();
	}
}
