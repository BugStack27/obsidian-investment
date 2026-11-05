import { App, Modal, Notice } from 'obsidian';
import { searchStocks } from '../services/stockSdk';
import { normalizeHoldingCode, type FundHoldingRow } from '../utils/holdingBlock';

export interface FundHoldingEditModalProps {
	fundCode: string;
	fundName: string;
	/** 当前 fund-holding 块解析出的行，弹窗内编辑副本 */
	rows: FundHoldingRow[];
	/** 保存回调：由调用方负责写回笔记文件 */
	onSave: (rows: FundHoldingRow[]) => void;
}

/**
 * 手动补充持仓编辑弹窗：
 * 上半部用 stock-sdk 股票搜索（名称/代码）添加 A 股；下半部表格编辑比例 / 是否当前持仓 / 删除。
 * 只编辑行数据副本，点「保存」经 onSave 写回笔记的 ```fund-holding``` 块。
 */
export class FundHoldingEditModal extends Modal {
	private readonly props: FundHoldingEditModalProps;
	private rows: FundHoldingRow[];
	private tableEl: HTMLElement | null = null;

	constructor(app: App, props: FundHoldingEditModalProps) {
		super(app);
		this.props = props;
		this.rows = props.rows.map((r) => ({ ...r }));
	}

	onOpen(): void {
		this.modalEl.addClass('inv-holding-edit-modal');
		const { contentEl } = this;

		contentEl.createDiv({
			cls: 'inv-holding-edit-title',
			text: `手动补充持仓 · ${this.props.fundName}（${this.props.fundCode}）`,
		});

		// 搜索添加（stock-sdk A 股搜索）
		const searchRow = contentEl.createDiv({ cls: 'inv-holding-edit-search' });
		const input = searchRow.createEl('input', {
			cls: 'inv-holding-edit-search-input',
			attr: { type: 'text', placeholder: '搜索股票名称/代码，回车搜索', spellcheck: 'false' },
		});
		const searchBtn = searchRow.createEl('button', {
			cls: 'inv-chart-preset',
			text: '搜索',
			attr: { type: 'button' },
		});
		const resultEl = contentEl.createDiv({ cls: 'inv-holding-edit-results' });

		const doSearch = async (): Promise<void> => {
			const kw = input.value.trim();
			if (!kw) return;
			resultEl.empty();
			resultEl.createDiv({ cls: 'inv-holding-edit-hint', text: '搜索中…' });
			try {
				const results = await searchStocks(kw, 8);
				resultEl.empty();
				if (results.length === 0) {
					resultEl.createDiv({ cls: 'inv-holding-edit-hint', text: '无匹配的 A 股' });
					return;
				}
				for (const r of results) {
					const item = resultEl.createDiv({ cls: 'inv-holding-edit-result' });
					item.createSpan({ text: r.name, cls: 'inv-holding-edit-result-name' });
					item.createSpan({ text: r.code, cls: 'inv-holding-edit-result-code' });
					item
						.createEl('button', { text: '添加', cls: 'inv-chart-preset', attr: { type: 'button' } })
						.addEventListener('click', () => {
							if (this.rows.some((x) => x.code === r.code)) {
								new Notice(`${r.code} 已在列表中`);
								return;
							}
							this.rows.push({ code: r.code, name: r.name, ratio: null, active: true });
							renderRows();
						});
				}
			} catch (e) {
				resultEl.empty();
				resultEl.createDiv({
					cls: 'inv-holding-edit-hint',
					text: `搜索失败：${e instanceof Error ? e.message : String(e)}`,
				});
			}
		};
		searchBtn.addEventListener('click', () => void doSearch());
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				void doSearch();
			}
		});

		const tableEl = contentEl.createDiv({ cls: 'inv-holding-edit-table' });
		const renderRows = (): void => {
			tableEl.empty();
			if (this.rows.length === 0) {
				tableEl.createDiv({
					cls: 'inv-holding-edit-hint',
					text: '暂无手动持仓，用上方搜索添加，或直接在笔记的 fund-holding 代码块里按 CSV 格式手改。',
				});
				return;
			}
			for (const row of this.rows) {
				const line = tableEl.createDiv({ cls: 'inv-holding-edit-row' });
				line.createSpan({ text: row.code, cls: 'inv-holding-edit-code' });
				line.createSpan({ text: row.name || row.code, cls: 'inv-holding-edit-name' });
				const ratio = line.createEl('input', {
					cls: 'inv-holding-edit-ratio',
					attr: { type: 'number', step: '0.01', min: '0', placeholder: '比例%' },
				});
				ratio.value = row.ratio == null ? '' : String(row.ratio);
				ratio.addEventListener('change', () => {
					const t = ratio.value.trim();
					const n = Number(t);
					row.ratio = t === '' || !Number.isFinite(n) ? null : n;
				});
				const active = line.createEl('input', { attr: { type: 'checkbox', title: '是否当前持仓' } });
				active.checked = row.active;
				active.addEventListener('change', () => {
					row.active = active.checked;
				});
				line
					.createEl('button', { text: '删除', cls: 'inv-chart-preset', attr: { type: 'button' } })
					.addEventListener('click', () => {
						this.rows = this.rows.filter((x) => x !== row);
						renderRows();
					});
			}
		};
		renderRows();

		const foot = contentEl.createDiv({ cls: 'inv-holding-edit-foot' });
		foot
			.createEl('button', {
				text: '保存到笔记',
				cls: 'inv-signal-btn confirm',
				attr: { type: 'button' },
			})
			.addEventListener('click', () => {
				// 过滤无效代码行（正常只可能来自手改 CSV）
				const clean = this.rows.filter((r) => normalizeHoldingCode(r.code) != null);
				if (clean.length !== this.rows.length) {
					new Notice('已忽略代码无效的行');
				}
				this.props.onSave(clean);
				this.close();
			});
		foot
			.createEl('button', { text: '取消', cls: 'inv-chart-preset', attr: { type: 'button' } })
			.addEventListener('click', () => this.close());
	}
}
