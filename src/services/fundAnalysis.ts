import type { App, TFile } from 'obsidian';
import type { HoldingSummary, NetWorthRecord, ResolvedTransaction } from '../types';
import { ATTR_SKIP_TRADE_NOTIFY, hasAttr } from '../utils/blockAttrs';
import { isFundNote, readFundNoteInfo } from '../utils/frontmatter';
import { getFirstRecordBlock, parseRecordSource } from '../utils/recordParser';
import { resolvePending, summarizeHolding, toNavByDate } from '../utils/returnCalc';
import { fetchFundNavHistory } from './stockSdk';

/** 单只基金的指标分析数据（指标分析弹窗与组合汇总的公共输入） */
export interface FundAnalysisData {
	code: string;
	name: string;
	filePath: string;
	navHistory: NetWorthRecord[];
	resolved: ResolvedTransaction[];
	summary: HoldingSummary;
	/** 记录块 fence 行设置了 skipTradeNotify：不参与买卖点提醒 */
	skipTradeNotify: boolean;
}

/** 从文件内容中提取第一个一级标题作为基金名（无则回退为代码） */
export function firstHeading(content: string, fallback: string): string {
	const m = content.match(/^\s*#\s+(.+)\s*$/m);
	return m ? m[1]!.trim() : fallback;
}

/** 基金加载失败的环节：净值拉取 / 笔记读取 / 持仓汇总 */
export type FundLoadFailureKind = 'nav' | 'read' | 'aggregate';

/** 「有记录但加载失败」的基金：供汇总卡、状态栏与操作弹窗点名 */
export interface FundLoadFailure {
	code: string;
	name: string;
	filePath: string;
	kind: FundLoadFailureKind;
	/** 归一化短原因，UI 直接展示 */
	reason: string;
	/** 上游原始报错，仅作 tooltip */
	detail: string;
}

/** 单只基金加载结果：`no-record` 表示笔记本来就没记录（不算失败） */
export type FundAnalysisResult =
	| { status: 'ok'; data: FundAnalysisData }
	| { status: 'no-record' }
	| { status: 'failed'; failure: FundLoadFailure };

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/**
 * 加载单只基金的指标分析数据，并区分「本来就没记录」与「有记录但加载失败」：
 * 读记录块 → 拉净值历史 → 补全待确认交易 → 汇总持仓与收益。读取、净值、汇总三段各自兜底。
 */
export async function loadFundAnalysisResult(
	app: App,
	file: TFile,
	code: string,
): Promise<FundAnalysisResult> {
	let content: string;
	try {
		content = await app.vault.cachedRead(file);
	} catch (e) {
		return {
			status: 'failed',
			failure: {
				code,
				name: file.basename,
				filePath: file.path,
				kind: 'read',
				reason: '笔记读取失败',
				detail: errorText(e),
			},
		};
	}

	// 失败清单用文件名兜底便于识别；ok 路径保持原口径（回退代码）
	const heading = firstHeading(content, '');
	const failName = heading || file.basename;
	const block = getFirstRecordBlock(content);
	if (!block) return { status: 'no-record' };
	const parsed = parseRecordSource(block.inner);
	if (parsed.entries.length === 0) return { status: 'no-record' };

	let navHistory: NetWorthRecord[];
	try {
		navHistory = await fetchFundNavHistory(code);
	} catch (e) {
		const detail = errorText(e);
		return {
			status: 'failed',
			failure: {
				code,
				name: failName,
				filePath: file.path,
				kind: 'nav',
				reason: detail.includes('无净值数据') ? '无净值数据' : '净值获取失败',
				detail,
			},
		};
	}

	try {
		const resolved = resolvePending(
			parsed.entries.map((e) => e.tx),
			toNavByDate(navHistory),
		);
		const summary = summarizeHolding(resolved, navHistory);
		return {
			status: 'ok',
			data: {
				code,
				name: heading || code,
				filePath: file.path,
				navHistory,
				resolved,
				summary,
				skipTradeNotify: hasAttr(block.attrs, ATTR_SKIP_TRADE_NOTIFY),
			},
		};
	} catch (e) {
		return {
			status: 'failed',
			failure: {
				code,
				name: failName,
				filePath: file.path,
				kind: 'aggregate',
				reason: '持仓汇总失败',
				detail: errorText(e),
			},
		};
	}
}

/**
 * 加载单只基金的指标分析数据；无记录块、无有效记录或加载失败时返回 null。
 * 需要区分失败原因（汇总视图点名）时用 `loadFundAnalysisResult`。
 */
export async function loadFundAnalysis(app: App, file: TFile, code: string): Promise<FundAnalysisData | null> {
	const result = await loadFundAnalysisResult(app, file, code);
	return result.status === 'ok' ? result.data : null;
}

/**
 * 扫描全部基金笔记，加载其中"当前持有份额 > 0"的基金分析数据（按名称排序）。
 * 同一基金代码只保留首个笔记，用于指标分析弹窗的左侧切换列表。
 */
export async function listHeldFunds(app: App): Promise<FundAnalysisData[]> {
	const seen = new Set<string>();
	const items: FundAnalysisData[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const info = readFundNoteInfo(app.metadataCache.getFileCache(file)?.frontmatter);
		if (!isFundNote(info.code, info.hasFundTag) || !info.code) continue;
		if (seen.has(info.code)) continue;
		seen.add(info.code);
		const data = await loadFundAnalysis(app, file, info.code);
		if (data && data.summary.holdShares > 0) items.push(data);
	}
	items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
	return items;
}
