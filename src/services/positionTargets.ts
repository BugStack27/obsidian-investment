import { type App, TFile } from 'obsidian';
import { isFundNote, isStockNote, readFundNoteInfo, readStockNoteInfo } from '../utils/frontmatter';
import { firstHeading } from './fundAnalysis';

/** 统一加减仓弹窗的一个候选标的（基金或股票，记录写回落到某篇笔记） */
export interface PositionTarget {
	kind: 'fund' | 'stock';
	code: string;
	/** 展示名：优先笔记一级标题，缺失回退代码 */
	name: string;
	/** 记录写入的目标笔记路径 */
	filePath: string;
}

/**
 * 扫描全库基金/股票笔记，产出统一弹窗的候选标的（**纯本地，零网络请求**）。
 * 基金 = frontmatter `fund_code` + `fund-investment` 标签；股票 = `stock_code` + `stock-investment` 标签。
 * 同一代码只取首个笔记（与 `buildFundCards` / `collectStockRecentTrades` 的 seen 语义一致）；
 * 单文件读取异常吞掉跳过，不中断整体扫描。组内按名称（中文）升序，保证顺序稳定。
 */
export async function collectPositionTargets(app: App): Promise<{
	funds: PositionTarget[];
	stocks: PositionTarget[];
}> {
	const funds: PositionTarget[] = [];
	const stocks: PositionTarget[] = [];
	const seenFund = new Set<string>();
	const seenStock = new Set<string>();

	for (const file of app.vault.getMarkdownFiles()) {
		const fm = app.metadataCache.getFileCache(file)?.frontmatter;
		const fund = readFundNoteInfo(fm);
		if (isFundNote(fund.code, fund.hasFundTag) && fund.code) {
			if (!seenFund.has(fund.code)) {
				seenFund.add(fund.code);
				funds.push(await toTarget(app, file, 'fund', fund.code));
			}
			continue;
		}
		const stock = readStockNoteInfo(fm);
		if (isStockNote(stock.code, stock.hasStockTag) && stock.code && !seenStock.has(stock.code)) {
			seenStock.add(stock.code);
			stocks.push(await toTarget(app, file, 'stock', stock.code));
		}
	}

	funds.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
	stocks.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
	return { funds, stocks };
}

/**
 * 当前活动笔记对应的标的（供「加减仓」命令预选）：
 * 基金/股票笔记返回 PositionTarget，其它笔记返回 null。
 */
export async function activePositionTarget(app: App): Promise<PositionTarget | null> {
	const file = app.workspace.getActiveFile();
	if (!(file instanceof TFile)) return null;
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	const fund = readFundNoteInfo(fm);
	if (isFundNote(fund.code, fund.hasFundTag) && fund.code) {
		return toTarget(app, file, 'fund', fund.code);
	}
	const stock = readStockNoteInfo(fm);
	if (isStockNote(stock.code, stock.hasStockTag) && stock.code) {
		return toTarget(app, file, 'stock', stock.code);
	}
	return null;
}

/** 由笔记文件组装 PositionTarget；标题读取失败时回退代码 */
async function toTarget(
	app: App,
	file: TFile,
	kind: PositionTarget['kind'],
	code: string,
): Promise<PositionTarget> {
	let name = code;
	try {
		name = firstHeading(await app.vault.cachedRead(file), code);
	} catch {
		// 读取失败按代码展示，不影响候选可用性
	}
	return { kind, code, name, filePath: file.path };
}
