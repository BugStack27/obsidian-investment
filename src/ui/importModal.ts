import { App, ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import type { Transaction } from '../types';
import { parseImportCsv, type ImportResult } from '../utils/importExport';
import { fmtMoney } from '../utils/format';

/**
 * 批量导入弹窗：粘贴 CSV 或选择文件 → 解析预览 → 确认导入。
 * 只保留关键字段（type/date/amount/shares/fee/note）。
 */
export class ImportModal extends Modal {
	private expectedFundCode: string | null;
	private onConfirm: (transactions: Transaction[]) => void;
	private result: ImportResult | null = null;

	private textEl: HTMLTextAreaElement | null = null;
	private summaryEl: HTMLDivElement | null = null;
	private confirmComp: ButtonComponent | null = null;

	constructor(
		app: App,
		expectedFundCode: string | null,
		onConfirm: (transactions: Transaction[]) => void,
	) {
		super(app);
		this.expectedFundCode = expectedFundCode;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.setTitle('批量导入买卖记录');
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('粘贴 CSV 或选择文件')
			.setDesc('支持带表头（如 日期,方向,金额,份额,手续费,备注 或 type,date,amount,shares,fee）或不带表头，仅提取关键字段。')
			.addButton((btn) =>
				btn.setButtonText('选择文件').onClick(() => this.chooseFile()),
			);

		this.textEl = contentEl.createEl('textarea', {
			attr: { placeholder: 'Type,date,amount,shares,fee\nbuy,2026-05-14,800', class: 'inv-import-text', rows: '8' },
		});
		this.textEl.addEventListener('input', () => this.reparse());

		this.summaryEl = contentEl.createDiv({ cls: 'inv-import-summary' });

		new Setting(contentEl).addButton((btn) => {
			this.confirmComp = btn.setButtonText('确认导入').setCta().setDisabled(true);
			btn.onClick(() => this.commit());
		});
		this.reparse();
	}

	private chooseFile(): void {
		const input = this.contentEl.createEl('input', {
			attr: { type: 'file', accept: '.csv,.txt,text/csv', style: 'display:none' },
		});
		input.addEventListener('change', () => {
			const f = input.files?.[0];
			if (!f) return;
			f.text()
				.then((content) => {
					if (this.textEl) this.textEl.value = content;
					this.reparse();
				})
				.catch(() => new Notice('读取文件失败'));
		});
		input.click();
	}

	private reparse(): void {
		const raw = this.textEl?.value ?? '';
		const result = parseImportCsv(raw, this.expectedFundCode);
		this.result = result;
		if (this.summaryEl) this.summaryEl.empty();

		const parts: string[] = [`有效 ${result.transactions.length} 条`];
		if (result.totalRows > 0) parts.push(`共 ${result.totalRows} 行`);
		if (result.invalidRows > 0) parts.push(`无效 ${result.invalidRows}`);
		if (result.skippedFundCode > 0) parts.push(`跳过其他基金 ${result.skippedFundCode}`);
		if (this.expectedFundCode && result.transactions.length === 0 && raw.trim() !== '') parts.push('(未解析到可用记录)');

		this.summaryEl?.createSpan({ text: parts.join(' ') });

		const ok = result.transactions.length > 0;
		this.confirmComp?.setDisabled(!ok);

		// 预览前 10 条
		const summaryEl = this.summaryEl;
		if (summaryEl) {
			const preview = summaryEl.createDiv({ cls: 'inv-import-preview' });
			result.transactions.slice(0, 10).forEach((t) => {
				const line = preview.createDiv({ cls: 'inv-preview-row' });
				const badge = t.type === 'buy'
					? { text: '买入', cls: 'inv-badge-buy' }
					: t.type === 'sell'
						? { text: '卖出', cls: 'inv-badge-sell' }
						: { text: '分红', cls: 'inv-badge-div' };
				line.createSpan({ text: badge.text, cls: `inv-badge ${badge.cls}` });
				line.createSpan({ text: ` ${t.date}  ` });
				if (t.amount > 0) line.createSpan({ text: fmtMoney(t.amount) });
				if (t.shares > 0) line.createSpan({ text: ` ${t.shares} 份` });
				if (t.fee > 0) line.createSpan({ text: `费 ${t.fee}` });
			});
			if (result.transactions.length > 10) {
				preview.createDiv({ text: `…另有 ${result.transactions.length - 10} 条`, cls: 'inv-hint' });
			}
		}
	}

	private commit(): void {
		const r = this.result;
		if (!r || r.transactions.length === 0) {
			new Notice('没有可导入的记录');
			return;
		}
		this.onConfirm(r.transactions);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}