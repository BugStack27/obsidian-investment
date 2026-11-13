import { Notice, setIcon, TFile, type App, type MarkdownPostProcessorContext } from 'obsidian';
import type InvestmentPlugin from '../main';
import type { HoldingSummary, NetWorthRecord, RecordParse, ResolvedTransaction } from '../types';
import { RECORD_BLOCK_LANG, type Transaction, type TxType } from '../types';
import {
	ATTR_SKIP_TRADE_NOTIFY,
	FUND_RECORD_ATTRS,
	hasAttr,
	parseFenceAttrs,
	type BlockAttrs,
} from '../utils/blockAttrs';
import { locateBlockAttrs } from '../utils/recordBlockLocate';
import {
	appendRecords,
	parseRecordSource,
	removeRecordAtLine,
	replaceRecordAtLine,
} from '../utils/recordParser';
import { transformRecordBlock } from '../utils/recordMutation';
import { toNavByDate, resolvePending, summarizeHolding } from '../utils/returnCalc';
import { calcAnnualRate } from '../utils/xirr';
import { calcDcaAnnual } from '../utils/dcaCalc';
import { todayKey } from '../services/signalAlerts';
import { readFundNoteInfo } from '../utils/frontmatter';
import { fetchFundNavHistory } from '../services/stockSdk';
import { fetchRealtimeEstimates, type RealtimeEstimate } from '../services/realtimeEstimate';
import { firstHeading } from '../services/fundAnalysis';
import type { PositionTarget } from '../services/positionTargets';
import { className, fmtMoney, fmtShares } from '../utils/format';
import { renderStatGrid, summaryStats } from './statGrid';
import { renderUnparsedHint } from './recordHint';
import { DcaCompareModal } from './dcaCompareModal';
import { renderCharts } from './charts';
import { calcLastYearProfit } from '../utils/profitChartCalc';
import { disposeAllCharts } from './charts/echartsInit';
import { PositionTradeModal } from './positionTradeModal';
import { ImportModal } from './importModal';
import { ConfirmModal } from './confirmModal';
import {
	dedupeTransactions,
	downloadCsv,
	transactionsToCsv,
} from '../utils/importExport';

export function registerRecordBlock(plugin: InvestmentPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
			RECORD_BLOCK_LANG,
		async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			const file = ctx.sourcePath
				? plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
				: null;
			const frontmatter =
				file instanceof TFile ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
			const info = readFundNoteInfo(frontmatter);
			const parsed = parseRecordSource(source);

			let navHistory: NetWorthRecord[] = [];
			let error = '';
			if (info.code) {
				try {
					navHistory = await fetchFundNavHistory(info.code);
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				}
			}
			const resolved = resolvePending(
				parsed.entries.map((e) => e.tx),
				toNavByDate(navHistory),
			);
			const summary = info.code ? summarizeHolding(resolved, navHistory) : null;
			const estimate = info.code
				? (await fetchRealtimeEstimates([info.code])).get(info.code) ?? null
				: null;

			if (!(file instanceof TFile)) {
				el.createEl('p', { text: '无法定位当前笔记文件。', cls: 'inv-hint' });
				return;
			}

			const attrs = await readBlockAttrs(plugin.app, file, ctx, el, source);

		renderBlock(plugin, el, {
			parsed,
			resolved,
			summary,
			estimate,
			navHistory,
			info,
			attrs,
			error,
			file,
			onMutate: (transform) => {
				return transformRecordBlock(plugin.app, file, transform)
					.then(() => plugin.app.workspace.trigger('layout-change'))
					.catch((e) => {
						new Notice(`写回记录失败：${e instanceof Error ? e.message : String(e)}`);
						throw e;
					});
			},
			});
		},
	);
}

interface BlockProps {
	parsed: RecordParse;
	resolved: ResolvedTransaction[];
	summary: HoldingSummary | null;
	estimate: RealtimeEstimate | null;
	navHistory: NetWorthRecord[];
	info: { code: string | null; hasFundTag: boolean };
	/** 该记录块 fence 行上的属性 */
	attrs: BlockAttrs;
	error: string;
	/** 当前笔记文件（统一弹窗锁定目标用） */
	file: TFile;
	/** 写回代码块内容；返回的 Promise 在写回完成后 resolve，写回失败时 reject（已内部提示） */
	onMutate: (transform: (inner: string) => string) => Promise<void>;
}

/**
 * 读取当前渲染记录块 fence 行上的属性。
 * 处理器拿到的 source 只含块内内容，故交由此前定位逻辑按「段行号 + 块内内容」双重条件择块；
 * 段信息不可用（嵌入/导出等）时退回按整份文件内容匹配。
 */
async function readBlockAttrs(
	app: App,
	file: TFile,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	source: string,
): Promise<BlockAttrs> {
	const section = ctx.getSectionInfo(el);
	if (section) return locateBlockAttrs(section.text, source, section.lineStart);
	try {
		return locateBlockAttrs(await app.vault.cachedRead(file), source, null);
	} catch {
		// 读取失败按无属性处理，不影响记录块其余渲染
		return parseFenceAttrs('');
	}
}

/** 渲染 fence 行属性提示：已关闭提醒说明 + 未知属性告警 */
function renderAttrHints(el: HTMLElement, attrs: BlockAttrs): void {
	if (hasAttr(attrs, ATTR_SKIP_TRADE_NOTIFY)) {
		el.createEl('p', {
			text: `已关闭买卖点提醒（${ATTR_SKIP_TRADE_NOTIFY}）`,
			cls: 'inv-hint inv-attr-off',
		});
	}
	if (attrs.unknown.length > 0) {
		const usable = FUND_RECORD_ATTRS.map((a) => a.name).join('、');
		el.createEl('p', {
			text: `无法识别的属性：${attrs.unknown.join('、')}｜可用属性：${usable}`,
			cls: 'inv-hint inv-attr-warn',
		});
	}
}

function renderBlock(plugin: InvestmentPlugin, el: HTMLElement, props: BlockProps): void {
	disposeAllCharts();
	el.empty();
	el.addClass('inv-record-block');
	renderAttrHints(el, props.attrs);

	if (!props.info.code) {
		el.createEl('p', {
			text: '该记录块需要基金代码。请在笔记 frontmatter 添加 fund_code，并在 tags 中加入 fund-investment。',
			cls: 'inv-hint',
		});
		return;
	}

	renderUnparsedHint(el, props.parsed.unparsed);

	if (props.error) {
		el.createEl('p', { text: `净值获取失败：${props.error}`, cls: 'inv-hint' });
	}

	if (props.summary) {
		const lastYear = props.navHistory.length > 0
			? calcLastYearProfit(props.navHistory, props.resolved)
			: null;
		const lastOp = { buy: calcLastOp('buy', props), sell: calcLastOp('sell', props) };
		const dca = calcDcaAnnual(props.resolved, props.navHistory);
		const openDcaCompare = () => {
			new DcaCompareModal(plugin, {
				navHistory: props.navHistory,
				resolved: props.resolved,
				summary: props.summary,
				code: props.info.code,
			}).open();
		};
		renderStatGrid(el, summaryStats(props.summary, props.estimate, lastYear, lastOp, annualFromStore(plugin, props), dca, openDcaCompare));
	}

	addActionButtons(el, plugin, props);
	renderCharts(plugin, el, {
		navHistory: props.navHistory,
		resolved: props.resolved,
		summary: props.summary,
		code: props.info.code,
	});
	renderTable(el, props, plugin);
}

/** 年化：优先复用数据中枢已算好的 fund-card annual（统一口径），数据中枢尚未就绪时本地兜底 */
function annualFromStore(plugin: InvestmentPlugin, props: BlockProps): number {
	const card = plugin.store.snapshot.cards.find((c) => c.code === props.info.code);
	if (card) return card.annual;
	const s = props.summary!;
	return (
		calcAnnualRate(props.resolved, s.holdShares, s.holdAmount, s.navDate) ??
		(s.holdDays >= 365 ? Math.pow(1 + s.totalProfitRate, 365 / s.holdDays) - 1 : s.totalProfitRate)
	);
}

/** 上次某类型操作：自交易日至今的净值涨跌幅（最新值优先用当日估值）及距今天数。无交易/当日无净值时返回 null */
function calcLastOp(
	type: 'buy' | 'sell',
	props: BlockProps,
): { change: number; days: number } | null {
	const ofType = props.resolved.filter((t) => t.type === type && !t.pending);
	if (ofType.length === 0 || props.navHistory.length === 0) return null;
	const lastTx = ofType.sort((a, b) => b.date.localeCompare(a.date))[0]!;
	const txNav = toNavByDate(props.navHistory).get(lastTx.date);
	if (txNav == null) return null;
	const latestNav =
		props.estimate && props.estimate.date === todayKey()
			? props.estimate.gsz
			: props.navHistory[props.navHistory.length - 1]!.netWorth;
	if (latestNav == null || latestNav <= 0) return null;
	const change = (latestNav - txNav) / latestNav;
	const days = Math.floor(
		(Date.now() - new Date(lastTx.date + 'T00:00:00').getTime()) / 86_400_000,
	);
	return { change, days };
}

function renderTable(el: HTMLElement, props: BlockProps, plugin: InvestmentPlugin): void {
	const wrap = el.createDiv({ cls: 'inv-record-table' });
	if (props.resolved.length === 0) {
		wrap.createEl('p', { text: '暂无买卖记录。点击下方"加仓/减仓"新增一条，或直接编辑代码块。', cls: 'inv-empty' });
		return;
	}

	const table = wrap.createEl('table');
	const head = table.createEl('thead').createEl('tr');
	['类型', '日期', '金额', '份额', '参考净值', '手续费', '备注', ''].forEach((h) =>
		head.createEl('th', { text: h }),
	);

	const body = table.createEl('tbody');
	const sorted = props.resolved
		.map((tx, idx) => ({ tx, lineIdx: props.parsed.entries[idx]?.lineIdx ?? idx }))
		.sort((a, b) => b.tx.date.localeCompare(a.tx.date));
	sorted.forEach(({ tx, lineIdx }) => {
		const tr = body.createEl('tr');
		const typeTd = tr.createEl('td');
		const typeBadge = tx.type === 'buy'
			? { text: '买入', cls: 'inv-badge-buy' }
			: tx.type === 'sell'
				? { text: '卖出', cls: 'inv-badge-sell' }
				: { text: '分红', cls: 'inv-badge-div' };
		typeTd.createSpan({ text: typeBadge.text, cls: className('inv-badge', typeBadge.cls) });
		tr.createEl('td', { text: tx.date });
		tr.createEl('td', { text: tx.amount > 0 ? fmtMoney(tx.amount) : '—' });
		tr.createEl('td', { text: tx.shares > 0 ? fmtShares(tx.shares) : '—' });
		tr.createEl('td', { text: tx.nav != null ? tx.nav.toFixed(4) : (tx.pending ? '待确认' : '—') });
		tr.createEl('td', { text: tx.fee > 0 ? fmtMoney(tx.fee) : '—' });
		tr.createEl('td', { text: tx.note || '—' });

		const ops = tr.createEl('td', { cls: 'inv-ops' });
		const mkOp = (icon: string, label: string, onClick: () => void): HTMLButtonElement => {
			const b = ops.createEl('button', {
				cls: className('inv-btn inv-icon-btn'),
				attr: { 'aria-label': label, 'title': label },
			});
			setIcon(b, icon);
			b.addEventListener('click', onClick);
			return b;
		};
		mkOp('pencil', '编辑', () => {
			void openEditModal(plugin, props, tx, lineIdx);
		});
		mkOp('trash', '删除', () => {
			// 删除会直接改写笔记文件且无法撤销，先弹确认弹窗写明要删的是哪一条
			const amountText = tx.amount > 0 ? fmtMoney(tx.amount) : '—';
			new ConfirmModal(
				plugin.app,
				{
					title: '删除交易记录',
					message: `确定要删除这条记录吗？\n类型：${typeBadge.text}\n日期：${tx.date}\n金额：${amountText}`,
					confirmText: '删除',
					danger: true,
				},
				() => {
					props
						.onMutate((inner) => {
							// 记录行可能已被其他改动移除，此时不能静默写回并谎报删除成功
							const next = removeRecordAtLine(inner, lineIdx);
							if (next == null) throw new Error('该记录已不存在，可能已被其他改动移除');
							return next;
						})
						.then(() => new Notice(`已删除 ${typeBadge.text} 记录（${tx.date}，${amountText}）`))
						.catch(() => undefined); // 写回失败已由 onMutate 内部提示
				},
			).open();
		});
	});
}

function addActionButtons(el: HTMLElement, plugin: InvestmentPlugin, props: BlockProps): void {
	if (!props.info.code) return;
	const row = el.createDiv({ cls: 'inv-actions' });

	const iconBtn = (icon: string, label: string, cls: string, onClick: () => void): HTMLButtonElement => {
		const b = row.createEl('button', {
			cls: className('inv-btn inv-icon-btn', cls),
			attr: { 'aria-label': label, 'title': label },
		});
		setIcon(b, icon);
		b.addEventListener('click', onClick);
		return b;
	};

	const openRecord = (type: TxType): void => {
		void openTradeModal(plugin, props, type);
	};
	iconBtn('plus', '加仓', 'inv-buy', () => openRecord('buy'));
	iconBtn('minus', '减仓', 'inv-sell', () => openRecord('sell'));
	iconBtn('gift', '分红', 'inv-div', () => openRecord('dividend'));

	iconBtn('upload', '批量导入', '', () => {
		new ImportModal(plugin.app, props.info.code, (imported) => {
			const added = dedupeTransactions(
				props.parsed.entries.map((e) => e.tx),
				imported,
			);
			if (added.length === 0) {
				new Notice('没有新记录（已全部存在）');
				return;
			}
			props
				.onMutate((inner) => appendRecords(inner, added))
				.then(() => new Notice(`已导入 ${added.length} 条记录`))
				.catch(() => undefined); // 写回失败已由 onMutate 内部提示
		}).open();
	});

	iconBtn('download', '导出全部记录', '', () => {
		const csv = transactionsToCsv(props.parsed.entries.map((e) => e.tx), props.info.code ?? undefined);
		downloadCsv(`${props.info.code ?? 'fund'}-records.csv`, csv);
		new Notice('已导出 CSV 文件');
	});
}

/** 打开统一加减仓弹窗新增一条记录（目标锁定为当前基金笔记，保存为追加记录行） */
async function openTradeModal(
	plugin: InvestmentPlugin,
	props: BlockProps,
	type: TxType,
): Promise<void> {
	const target = await fundTarget(plugin, props);
	new PositionTradeModal(
		plugin,
		{
			target,
			targetLocked: true,
			type,
			resolveAvailableShares: async () =>
				props.parsed.entries.length > 0 ? (props.summary?.holdShares ?? null) : null,
		},
		(tx) => {
			props.onMutate((inner) => appendRecords(inner, [tx])).catch(() => undefined);
		},
	).open();
}

/** 打开统一弹窗编辑某行记录（目标与类型锁定、数值预填，保存为替换该行） */
async function openEditModal(
	plugin: InvestmentPlugin,
	props: BlockProps,
	tx: Transaction,
	lineIdx: number,
): Promise<void> {
	const target = await fundTarget(plugin, props);
	new PositionTradeModal(
		plugin,
		{
			target,
			targetLocked: true,
			type: tx.type,
			typeLocked: true,
			date: tx.date,
			amount: tx.amount,
			shares: tx.shares,
			fee: tx.fee,
			note: tx.note,
			// 替换记录时先把自己占用的份额还回上限，避免只改小数位也被拦
			resolveAvailableShares: async () =>
				(props.summary?.holdShares ?? 0) + (tx.type === 'sell' ? tx.shares : 0),
		},
		(updated) => {
			props.onMutate((inner) => replaceRecordAtLine(inner, lineIdx, updated) ?? inner).catch(() => undefined);
		},
	).open();
}

/** 当前基金笔记对应的锁定目标；名称取笔记一级标题，读取失败回退代码 */
async function fundTarget(plugin: InvestmentPlugin, props: BlockProps): Promise<PositionTarget> {
	const code = props.info.code ?? '';
	return {
		kind: 'fund',
		code,
		name: await noteName(plugin.app, props.file, code),
		filePath: props.file.path,
	};
}

async function noteName(app: App, file: TFile, code: string): Promise<string> {
	try {
		return firstHeading(await app.vault.cachedRead(file), code);
	} catch {
		return code;
	}
}