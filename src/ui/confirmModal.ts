import { App, Modal, Setting } from 'obsidian';

export interface ConfirmModalOptions {
	/** 弹窗标题 */
	title: string;
	/** 正文（可用 \n 换行） */
	message: string;
	/** 确认按钮文案，默认「确认」 */
	confirmText?: string;
	/** 取消按钮文案，默认「取消」 */
	cancelText?: string;
	/** 危险操作（确认按钮显示为警示色），默认 false */
	danger?: boolean;
}

/**
 * 通用确认弹窗：正文写明操作对象，用户确认后才执行回调。
 * 取消或关闭弹窗都不会触发回调。
 */
export class ConfirmModal extends Modal {
	private readonly opts: ConfirmModalOptions;
	private readonly onConfirm: () => void;

	constructor(app: App, opts: ConfirmModalOptions, onConfirm: () => void) {
		super(app);
		this.opts = opts;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.setTitle(this.opts.title);
		const { contentEl } = this;

		// 首行是引导问句（弱化），其余为决策关键信息（正文样式，便于阅读核对）
		const lines = this.opts.message.split('\n');
		lines.forEach((line, i) => {
			const p = contentEl.createEl('p', { text: line });
			if (i === 0) p.addClass('inv-hint');
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(this.opts.cancelText ?? '取消').onClick(() => this.close()),
			)
			.addButton((btn) => {
				btn.setButtonText(this.opts.confirmText ?? '确认');
				if (this.opts.danger) btn.setWarning();
				btn.onClick(() => {
					this.close();
					this.onConfirm();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
