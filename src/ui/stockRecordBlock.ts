import { Notice, setIcon, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import type InvestmentPlugin from '../main';
import {
	fetchStockKline,
	fetchStockQuote,
	type StockKlinePeriod,
	type StockQuote,
} from '../services/stockSdk';
import {
	STOCK_RECORD_BLOCK_LANG,
	type RecordParse,
	type Transaction,
	type TxType,
} from '../types';
import { readStockNoteInfo } from '../utils/frontmatter';
import { appendRecords, parseRecordSource, removeRecordAtLine, replaceRecordAtLine } from '../utils/recordParser';
import { transformRecordBlock } from '../utils/recordMutation';
import {
	className,
	fmtMoney,
	fmtPercent,
	fmtShares,
	fmtSignedMoney,
	profitColor,
} from '../utils/format';
import { renderStatGrid, type StatItem } from './statGrid';
import { renderUnparsedHint } from './recordHint';
import { buildStockKlineOption } from './charts/stockKline';
import {
	disposeAllCharts,
	disposeChart,
	initChart,
	type ChartInstance,
} from './charts/echartsInit';
import { PositionTradeModal } from './positionTradeModal';
import { ConfirmModal } from './confirmModal';
import { sumStockHoldShares } from '../services/positionHolding';
import { summarizeStockHolding } from '../services/stockPortfolio';
import type { PositionTarget } from '../services/positionTargets';

const PERIODS: { key: StockKlinePeriod; label: string }[] = [
	{ key: 'daily', label: '日线' },
	{ key: 'weekly', label: '周线' },
	{ key: 'monthly', label: '月线' },
];

export function registerStockRecordBlock(plugin: InvestmentPlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		STOCK_RECORD_BLOCK_LANG,
		async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			disposeAllCharts();
			const file = ctx.sourcePath
				? plugin.app.vault.getAbstractFileByPath(ctx.sourcePath)
				: null;
			if (!(file instanceof TFile)) {
				el.addClass('inv-record-block');
				el.createEl('p', { text: '无法定位当前笔记文件。', cls: 'inv-hint' });
				return;
			}
			const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
			const info = readStockNoteInfo(frontmatter);
			const parsed = parseRecordSource(source);

			if (!info.code) {
				el.addClass('inv-record-block');
				el.createEl('p', {
					text: '该记录块需要股票代码。请在笔记 frontmatter 添加 stock_code，并在 tags 中加入 stock-investment。',
					cls: 'inv-hint',
				});
				return;
			}

			const quote = await fetchStockQuote(info.code);
			renderStockBlock(plugin, el, {
				code: info.code,
				filePath: file.path,
				parsed,
				quote,
				onMutate: (transform) => {
					return transformRecordBlock(plugin.app, file, transform, STOCK_RECORD_BLOCK_LANG)
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

interface StockBlockProps {
	code: string;
	/** 当前股票笔记路径（统一弹窗锁定目标用） */
	filePath: string;
	parsed: RecordParse;
	quote: StockQuote | null;
	/** 写回代码块内容；返回的 Promise 在写回完成后 resolve，写回失败时 reject（已内部提示） */
	onMutate: (transform: (inner: string) => string) => Promise<void>;
}

function renderStockBlock(plugin: InvestmentPlugin, el: HTMLElement, props: StockBlockProps): void {
	el.empty();
	el.addClass('inv-record-block');

	const header = el.createDiv({ cls: 'inv-stock-header' });
	header.createDiv({ text: props.quote?.name ?? props.code, cls: 'inv-stock-name' });
	header.createDiv({ text: props.code, cls: 'inv-stock-code' });

	renderUnparsedHint(el, props.parsed.unparsed);

	const summary = summarizeStockHolding(props.parsed.entries, props.quote);
	const quoteOk = props.quote != null;
	// 总收益卡只在口径与持仓盈亏分叉时出现：有卖出回款或分红才拉开差距，
	// 从未卖出过的标的再加一张数值完全相同的卡只是噪声
	const showTotal = summary.totalSellAmount > 0 || summary.totalDividend > 0;
	// 已清仓时市值恒为 0、不依赖行情，行情拉取失败也应给出总收益（此时全是已兑现部分）
	const totalOk = quoteOk || summary.holdShares === 0;

	const stats: StatItem[] = [
		{
			label: '最新价',
			value: props.quote ? fmtMoney(props.quote.price) : '—',
			color: props.quote ? profitColor(props.quote.changePercent) : undefined,
			sub: props.quote ? fmtPercent(props.quote.changePercent / 100, 2, true) : '行情获取失败',
			subColor: props.quote ? profitColor(props.quote.changePercent) : undefined,
		},
		{ label: '持仓数量', value: fmtShares(summary.holdShares) },
		{
			label: '持仓成本',
			value: summary.avgCostPerShare > 0 ? `${fmtMoney(summary.avgCostPerShare, 3)}/股` : '—',
			sub: summary.costBasis > 0 ? `成本基准：${fmtMoney(summary.costBasis)}` : undefined,
		},
		{ label: '持仓市值', value: summary.holdAmount > 0 ? fmtMoney(summary.holdAmount) : '—' },
		{
			// 行情不可用时市值按 0 计会得出 −100%，需显示为不可用而非巨额亏损
			label: '持仓盈亏',
			value: quoteOk ? fmtSignedMoney(summary.holdingProfit) : '—',
			color: quoteOk ? profitColor(summary.holdingProfit) : undefined,
			sub: `收益率：${quoteOk ? fmtPercent(summary.holdingProfitRate, 2, true) : '—'}`,
			subColor: quoteOk ? profitColor(summary.holdingProfit) : undefined,
		},
		...(showTotal
			? [
					{
						label: '总收益',
						value: totalOk ? fmtSignedMoney(summary.totalProfit) : '—',
						color: totalOk ? profitColor(summary.totalProfit) : undefined,
						sub: `收益率：${totalOk ? fmtPercent(summary.totalProfitRate, 2, true) : '—'}`,
						subColor: totalOk ? profitColor(summary.totalProfit) : undefined,
					},
				]
			: []),
	];
	renderStatGrid(el, stats);

	renderKlineCard(el, props.code, props.parsed.entries.map((e) => e.tx));
	addActionButtons(plugin, el, props);
	renderStockTable(plugin, el, props);
}

/** 当前股票笔记对应的锁定目标（表格行编辑与快捷按钮共用，避免两处构造漂移） */
function stockTarget(props: StockBlockProps): PositionTarget {
	return {
		kind: 'stock',
		code: props.code,
		name: props.quote?.name ?? props.code,
		filePath: props.filePath,
	};
}

/** 加仓 / 减仓 / 分红快捷按钮（图标按钮，打开统一弹窗，价格默认预填最新价） */
function addActionButtons(plugin: InvestmentPlugin, el: HTMLElement, props: StockBlockProps): void {
	const row = el.createDiv({ cls: 'inv-actions' });

	const iconBtn = (icon: string, label: string, cls: string, onClick: () => void): void => {
		const b = row.createEl('button', {
			cls: className('inv-btn inv-icon-btn', cls),
			attr: { 'aria-label': label, title: label },
		});
		setIcon(b, icon);
		b.addEventListener('click', onClick);
	};

	const openRecord = (type: TxType): void => {
		new PositionTradeModal(
			plugin,
			{
				target: stockTarget(props),
				targetLocked: true,
				type,
				price: props.quote?.price,
				resolveAvailableShares: async () =>
					props.parsed.entries.length > 0
						? sumStockHoldShares(props.parsed.entries)
						: null,
			},
			(tx) => {
				props.onMutate((inner) => appendRecords(inner, [tx])).catch(() => undefined);
			},
		).open();
	};
	iconBtn('plus', '加仓', 'inv-buy', () => openRecord('buy'));
	iconBtn('minus', '减仓', 'inv-sell', () => openRecord('sell'));
	iconBtn('gift', '分红', 'inv-div', () => openRecord('dividend'));
}

/** K 线走势卡片：日线 / 周线 / 月线切换，K 线上标记实际买入/卖出点 */
function renderKlineCard(el: HTMLElement, code: string, transactions: Transaction[]): void {
	const card = el.createDiv({ cls: 'inv-chart-card' });
	const head = card.createDiv({ cls: 'inv-chart-head' });
	head.createSpan({ text: 'K线走势', cls: 'inv-chart-title' });
	const tabsEl = head.createDiv({ cls: 'inv-chart-tabs' });
	const body = card.createDiv({ cls: 'inv-chart-body' });

	let chart: ChartInstance | null = null;
	let generation = 0;

	const render = async (period: StockKlinePeriod): Promise<void> => {
		const gen = ++generation;
		disposeChart(chart);
		chart = null;
		body.empty();
		body.createEl('p', { text: '加载中…', cls: 'inv-chart-empty' });

		const points = await fetchStockKline(code, period);
		if (gen !== generation) return;

		disposeChart(chart);
		chart = null;
		body.empty();
		if (points.length === 0) {
			body.createEl('p', { text: '暂无K线数据', cls: 'inv-chart-empty' });
			return;
		}
		chart = initChart(body, buildStockKlineOption(points, transactions));
	};

	PERIODS.forEach((p) => {
		const tab = tabsEl.createEl('button', {
			cls: 'inv-chart-tab' + (p.key === 'daily' ? ' active' : ''),
			text: p.label,
			attr: { type: 'button' },
		});
		tab.addEventListener('click', () => {
			if (tab.classList.contains('active')) return;
			tabsEl.querySelectorAll('.inv-chart-tab').forEach((t) => t.classList.remove('active'));
			tab.classList.add('active');
			void render(p.key);
		});
	});

	void render('daily');
}

function renderStockTable(plugin: InvestmentPlugin, el: HTMLElement, props: StockBlockProps): void {
	const wrap = el.createDiv({ cls: 'inv-record-table' });
	if (props.parsed.entries.length === 0) {
		wrap.createEl('p', {
			text: '暂无交易记录。点击下方"加仓/减仓"新增一条，或直接编辑代码块。',
			cls: 'inv-empty',
		});
		return;
	}

	const table = wrap.createEl('table');
	const head = table.createEl('thead').createEl('tr');
	['类型', '日期', '金额', '数量', '手续费', '备注', ''].forEach((h) =>
		head.createEl('th', { text: h }),
	);

	const body = table.createEl('tbody');
	// 保留 lineIdx 才能写回原始源码行；排序仅影响展示顺序
	const sorted = [...props.parsed.entries].sort((a, b) => b.tx.date.localeCompare(a.tx.date));
	for (const { tx, lineIdx } of sorted) {
		const tr = body.createEl('tr');
		const typeTd = tr.createEl('td');
		const badge =
			tx.type === 'buy'
				? { text: '买入', cls: 'inv-badge-buy' }
				: tx.type === 'sell'
					? { text: '卖出', cls: 'inv-badge-sell' }
					: { text: '分红', cls: 'inv-badge-div' };
		typeTd.createSpan({ text: badge.text, cls: className('inv-badge', badge.cls) });
		tr.createEl('td', { text: tx.date });
		tr.createEl('td', { text: tx.amount > 0 ? fmtMoney(tx.amount) : '—' });
		tr.createEl('td', { text: tx.shares > 0 ? fmtShares(tx.shares) : '—' });
		tr.createEl('td', { text: tx.fee > 0 ? fmtMoney(tx.fee) : '—' });
		tr.createEl('td', { text: tx.note || '—' });

		const ops = tr.createEl('td', { cls: 'inv-ops' });
		const mkOp = (icon: string, label: string, onClick: () => void): void => {
			const b = ops.createEl('button', {
				cls: className('inv-btn inv-icon-btn'),
				attr: { 'aria-label': label, title: label },
			});
			setIcon(b, icon);
			b.addEventListener('click', onClick);
		};
		// 三种记录均可编辑；分红行按金额回填，买卖行按「金额 ÷ 数量」反算价格
		mkOp('pencil', '编辑', () => openEditModal(plugin, props, tx, lineIdx));
		mkOp('trash', '删除', () => confirmDeleteRecord(plugin, props, tx, lineIdx, badge.text));
	}
}

/** 打开统一弹窗编辑某行记录（目标与类型锁定，买卖价格按「金额 ÷ 数量」回显、分红按金额回填，保存为替换该行） */
function openEditModal(
	plugin: InvestmentPlugin,
	props: StockBlockProps,
	tx: Transaction,
	lineIdx: number,
): void {
	// 记录行只存金额与数量：买卖行需按「数量 × 价格」反算金额，故必须传 price；
	// 分红行金额独立存在，传 amount，且弹窗在分红类型下不会拉行情预填价格
	const price = tx.shares > 0 ? Math.round((tx.amount / tx.shares) * 100) / 100 : 0;
	new PositionTradeModal(
		plugin,
		{
			target: stockTarget(props),
			targetLocked: true,
			type: tx.type,
			typeLocked: true,
			date: tx.date,
			amount: tx.amount,
			shares: tx.shares,
			price,
			fee: tx.fee,
			note: tx.note,
			// 替换记录时先把自己占用的份额还回上限，避免只改小数位也被拦
			resolveAvailableShares: async () =>
				sumStockHoldShares(props.parsed.entries) + (tx.type === 'sell' ? tx.shares : 0),
		},
		(updated) => {
			props
				.onMutate((inner) => {
					const next = replaceRecordAtLine(inner, lineIdx, updated);
					if (next == null) throw new Error('该记录已不存在，可能已被其他改动移除');
					return next;
				})
				.catch(() => undefined);
		},
	).open();
}

/** 删除某行记录：删除会直接改写笔记文件且无法撤销，先弹确认弹窗写明要删的是哪一条 */
function confirmDeleteRecord(
	plugin: InvestmentPlugin,
	props: StockBlockProps,
	tx: Transaction,
	lineIdx: number,
	typeText: string,
): void {
	const amountText = tx.amount > 0 ? fmtMoney(tx.amount) : '—';
	new ConfirmModal(
		plugin.app,
		{
			title: '删除交易记录',
			message: `确定要删除这条记录吗？\n类型：${typeText}\n日期：${tx.date}\n金额：${amountText}`,
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
				.then(() => new Notice(`已删除 ${typeText} 记录（${tx.date}，${amountText}）`))
				.catch(() => undefined);
		},
	).open();
}
