import { MarkdownView, Notice, Plugin, TAbstractFile, TFile, TFolder, setIcon } from 'obsidian';
import { InvestmentDataStore, type StoreSnapshot } from './data/investmentStore';
import { todayProfitDateLabel } from './services/portfolioOverview';
import { activePositionTarget } from './services/positionTargets';
import { resolveAvailableShares } from './services/positionHolding';
import { type SignalStatus, isSignalWindow } from './services/signalAlerts';
import { searchFunds, searchStocks, setCacheHours } from './services/stockSdk';
import { DEFAULT_SETTINGS, InvestmentSettingTab, InvestmentSettings } from './settings';
import { RECORD_BLOCK_LANG, STOCK_RECORD_BLOCK_LANG } from './types';
import { ChannelModal } from './ui/channelModal';
import { renderFundFailureLine, type FundFailureHandlers } from './ui/fundFailureNotice';
import { FUND_VIEW_TYPE, FundView } from './ui/fundView';
import { PositionTradeModal } from './ui/positionTradeModal';
import { RecentTradesModal } from './ui/recentTradesModal';
import { RecordAttrSuggest } from './ui/recordAttrSuggest';
import { registerRecordBlock } from './ui/recordBlock';
import { SearchModal, type SearchPick } from './ui/searchModal';
import { SignalModal } from './ui/signalModal';
import { registerStockRecordBlock } from './ui/stockRecordBlock';
import { openTradeNote } from './ui/tradeList';
import { fmtMoney, fmtPercent, fmtSignedMoney, profitColor } from './utils/format';
import { isFundNote, isStockNote, readFundNoteInfo, readStockNoteInfo } from './utils/frontmatter';
import { appendTxToFile } from './utils/recordMutation';

export default class InvestmentPlugin extends Plugin {
	settings!: InvestmentSettings;
	/** 全项目数据流中枢：统一缓存净值/估值/卡片/汇总/信号，各视图订阅快照渲染 */
	store!: InvestmentDataStore;

	private statusEl: HTMLElement | null = null;
	private todayUnsub: (() => void) | null = null;
	private storeTimer: number | null = null;
	/** 最近一次是否处于信号统计窗口（≥13:00），用于跨过 13:00 时首次显示信号徽标 */
	private lastWindowIn = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		setCacheHours(this.settings.navCacheHours);
		this.store = new InvestmentDataStore(this);

		registerRecordBlock(this);
		registerStockRecordBlock(this);
		this.registerEditorSuggest(new RecordAttrSuggest(this.app));

		this.registerView(FUND_VIEW_TYPE, (leaf) => new FundView(leaf, this));

		this.addRibbonIcon('chart-line', '打开基金汇总侧栏', async () => {
			await this.ensureFundView();
		});

		this.addCommand({
			id: 'open-fund-analysis',
			name: '打开基金汇总侧栏',
			callback: async () => {
				await this.ensureFundView();
			},
		});

		this.addCommand({
			id: 'open-indicator-analysis',
			name: '打开指标分析',
			callback: () => {
				new ChannelModal(this, { initialCode: this.activeFundCode() }).open();
			},
		});

		this.addCommand({
			id: 'show-recent-trades',
			name: '查看近期操作',
			callback: () => {
				new RecentTradesModal(this).open();
			},
		});

		this.addCommand({
			id: 'add-reduce-position',
			name: '加减仓',
			callback: async () => {
				// 当前笔记是基金/股票笔记时预选该标的（不锁定，可改选）；保存写回对应笔记的记录块
				const target = await activePositionTarget(this.app);
				new PositionTradeModal(
					this,
					{
						target: target ?? undefined,
						resolveAvailableShares: (t) => resolveAvailableShares(this.app, t),
					},
					async (tx, t) => {
						const file = this.app.vault.getAbstractFileByPath(t.filePath);
						if (!(file instanceof TFile)) {
							const msg = '找不到笔记文件，无法写入记录';
							new Notice(msg);
							throw new Error(msg); // 让弹窗知道写回失败，保留已填内容
						}
						try {
							await appendTxToFile(this.app, file, [tx], t.kind === 'stock' ? STOCK_RECORD_BLOCK_LANG : RECORD_BLOCK_LANG);
							new Notice(`已记录：${t.name}`);
						} catch (e) {
							new Notice(`记录失败：${e instanceof Error ? e.message : String(e)}`);
							throw e;
						}
					},
				).open();
			},
		});

		this.addCommand({
			id: 'insert-fund-record-block',
			name: '在当前笔记插入 fund-record 买卖代码块',
			editorCallback: (editor) => {
				if (!editor) return;
				const end = editor.posToOffset(editor.getCursor());
				const source = editor.getValue();
				const head = source.slice(0, end);
				const tail = source.slice(end);
				editor.setValue(`${head}\n\`\`\`${RECORD_BLOCK_LANG}\n# 每行一条：type,date,金额[,份额][,手续费][,备注]\n\`\`\`\n${tail}`);
			},
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => this.applyDefaultMode()),
		);

		this.registerEvent(
			this.app.workspace.on('file-open', () => this.applyDefaultMode()),
		);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) => {
					item
						.setTitle('添加基金')
						.setIcon('search')
						.onClick(() => this.addFundToFolder(file));
				});
				menu.addItem((item) => {
					item
						.setTitle('添加股票')
						.setIcon('search')
						.onClick(() => this.addStockToFolder(file));
				});
			}),
		);

		this.setupStatusBar();

		this.addSettingTab(new InvestmentSettingTab(this.app, this));
	}

	onunload(): void {}

	private activeFundCode(): string | null {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile)) return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const info = readFundNoteInfo(fm);
		return isFundNote(info.code, info.hasFundTag) ? info.code : null;
	}

	/** 打开基金笔记时，按设置强制默认编辑/阅读模式 */
	private applyDefaultMode(): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (!(activeFile instanceof TFile)) return;
		const info = readFundNoteInfo(this.app.metadataCache.getFileCache(activeFile)?.frontmatter);
		if (!isFundNote(info.code, info.hasFundTag)) return;

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) return;
		const target = this.settings.openFundInEdit ? 'source' : 'preview';
		if (view.getMode() === target) return;
		// 本地类型缺省 setMode API，用 leaf.setViewState 以目标模式重开当前视图
		void view.leaf.setViewState({
			type: 'markdown',
			state: { file: view.file.path, mode: target },
		});
	}

	private async ensureFundView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(FUND_VIEW_TYPE);
		let leaf = leaves[0];
		if (!leaf) {
			// 固定放在左侧边栏
			const left = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getRightLeaf(false);
			if (!left) {
				new Notice('无法创建侧栏视图');
				return;
			}
			await left.setViewState({ type: FUND_VIEW_TYPE, active: true });
			leaf = left;
		} else {
			await this.app.workspace.revealLeaf(leaf);
		}
		(leaf.view as FundView).refresh();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<InvestmentSettings>);
	}

	async saveSettings(): Promise<void> {
		setCacheHours(this.settings.navCacheHours);
		await this.saveData(this.settings);
	}

	private addFundToFolder(folder: TFolder): void {
		new SearchModal(this.app, {
			title: '添加基金 — 搜索',
			placeholder: '输入基金代码或名称，如 011036 或 稀土',
			search: (kw) => searchFunds(kw),
			onPick: (pick) => {
				void this.createFundNote(folder, pick).catch((e) => {
					new Notice(`创建基金笔记失败：${e instanceof Error ? e.message : String(e)}`);
				});
			},
		}).open();
	}

	private addStockToFolder(folder: TFolder): void {
		new SearchModal(this.app, {
			title: '添加股票 — 搜索',
			placeholder: '输入股票代码或名称，如 600519 或 茅台',
			search: (kw) => searchStocks(kw),
			onPick: (pick) => {
				void this.createStockNote(folder, pick).catch((e) => {
					new Notice(`创建股票笔记失败：${e instanceof Error ? e.message : String(e)}`);
				});
			},
		}).open();
	}

	private async createFundNote(folder: TFolder, pick: SearchPick): Promise<void> {
		const safe = (pick.name || pick.code).replace(/[\\/:*?"<>|]/g, ' ').trim() || pick.code;
		const dir = folder.path === '/' ? '' : folder.path;
		let fileName = `${safe}.md`;
		let i = 2;
		while (this.app.vault.getAbstractFileByPath(`${dir}/${fileName}`)) {
			fileName = `${safe} ${i}.md`;
			i++;
		}

		const content = [
			'---',
			`fund_code: "${pick.code}"`,
			'tags:',
			'  - fund-investment',
			'---',
			'',
			`# ${pick.name}`,
			'',
			'```' + RECORD_BLOCK_LANG,
			'# 每行一条：type,date,金额[,份额][,手续费][,备注]',
			'```',
			'',
		].join('\n');

		await this.app.vault.create(`${dir}/${fileName}`, content);
		const created = this.app.vault.getAbstractFileByPath(`${dir}/${fileName}`);
		if (created instanceof TFile) {
			const openState: { state?: { mode: string } } | undefined = this.settings.openFundInEdit
				? { state: { mode: 'source' } }
				: undefined;
			await this.app.workspace.getLeaf(false).openFile(created, openState);
		}
		new Notice(`已创建基金笔记：${pick.name}`);
	}

	private async createStockNote(folder: TFolder, pick: SearchPick): Promise<void> {
		const safe = (pick.name || pick.code).replace(/[\\/:*?"<>|]/g, ' ').trim() || pick.code;
		const dir = folder.path === '/' ? '' : folder.path;
		let fileName = `${safe}.md`;
		let i = 2;
		while (this.app.vault.getAbstractFileByPath(`${dir}/${fileName}`)) {
			fileName = `${safe} ${i}.md`;
			i++;
		}

		const content = [
			'---',
			`stock_code: "${pick.code}"`,
			'tags:',
			'  - stock-investment',
			'---',
			'',
			`# ${pick.name}`,
			'',
			'```' + STOCK_RECORD_BLOCK_LANG,
			'# 每行一条：type,date,金额,数量[,手续费][,备注]',
			'```',
			'',
		].join('\n');

		await this.app.vault.create(`${dir}/${fileName}`, content);
		const created = this.app.vault.getAbstractFileByPath(`${dir}/${fileName}`);
		if (created instanceof TFile) {
			const openState: { state?: { mode: string } } | undefined = this.settings.openFundInEdit
				? { state: { mode: 'source' } }
				: undefined;
			await this.app.workspace.getLeaf(false).openFile(created, openState);
		}
		new Notice(`已创建股票笔记：${pick.name}`);
	}

	private setupStatusBar(): void {
		this.statusEl = this.addStatusBarItem();
		// 订阅数据流中枢：full/status 重建状态栏；estimate 由共享"今日"输出位原地更新
		this.store.subscribe((s) => this.onStoreSnapshot(s));

		// 基金/股票笔记内容或元数据变化时触发全量刷新（防抖，避免频繁磁盘扫描）
		this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onFileChanged(file)));
		this.registerEvent(this.app.vault.on('create', (file) => this.onFileChanged(file)));
		this.registerEvent(this.app.vault.on('delete', () => this.scheduleStoreRefresh()));
		// 周期性驱动：交易时段每 60s 轻量估值刷新，每小时补一次全量（逻辑在 store 内）
		this.registerInterval(window.setInterval(() => this.store.tick(), 60 * 1000));

		void this.store.refresh();
	}

	private onStoreSnapshot(s: StoreSnapshot): void {
		const inWindow = isSignalWindow();
		const crossedWindow = inWindow && !this.lastWindowIn;
		this.lastWindowIn = inWindow;
		// 盘中估值刷新：今日金额由共享输出位原地更新；仅跨过 13:00 时重建一次，使信号徽标首次出现
		if (s.change === 'estimate') {
			if (crossedWindow) this.renderStatusBar(s);
			return;
		}
		this.renderStatusBar(s);
	}

	/** 基金/股票笔记内容或元数据变化时触发数据流刷新（近期操作含股票记录，需感知股票笔记变更） */
	private onFileChanged(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const fund = readFundNoteInfo(fm);
		if (isFundNote(fund.code, fund.hasFundTag)) {
			this.scheduleStoreRefresh();
			return;
		}
		const stock = readStockNoteInfo(fm);
		if (isStockNote(stock.code, stock.hasStockTag)) this.scheduleStoreRefresh();
	}

	/** 基金数据变化后防抖触发数据流全量重建 */
	private scheduleStoreRefresh(): void {
		if (this.storeTimer) window.clearTimeout(this.storeTimer);
		this.storeTimer = window.setTimeout(() => {
			this.storeTimer = null;
			void this.store.refresh();
		}, 1200);
	}

	/** 失败清单交互：打开对应笔记 / 重新加载（再走一次数据中枢全量刷新） */
	private failureHandlers(): FundFailureHandlers {
		return {
			onOpen: (f) => openTradeNote(this.app, this.settings.openFundInEdit, f.filePath),
			onRetry: () => void this.store.refresh(),
		};
	}

	private renderStatusBar(s: StoreSnapshot): void {
		const el = this.statusEl;
		if (!el) return;
		if (this.todayUnsub) {
			this.todayUnsub();
			this.todayUnsub = null;
		}
		el.empty();

		const hasStock = s.overview.stockCount > 0 || s.overview.unpricedStockCount > 0;
		if (s.cards.length === 0 && !hasStock) {
			if (s.error) {
				el.createSpan({ text: `基金汇总失败：${s.error}`, cls: 'inv-sb-extra' });
			} else if (s.failedFunds.length > 0) {
				renderFundFailureLine(el, s.failedFunds, this.failureHandlers());
			} else {
				el.createSpan({ text: '计算中…', cls: 'inv-sb-extra' });
			}
			return;
		}

		const { overview, signals } = s;
		el.createSpan({
			text: `总资产 ${fmtMoney(overview.totalAssets)}`,
			cls: 'inv-sb-seg',
			attr: { title: '总资产 = 基金市值 + 股票市值' },
		});
		const profit = el.createSpan({
			text: `累计收益 ${fmtMoney(overview.totalProfit)}`,
			cls: 'inv-sb-seg',
			attr: { title: '累计收益 = 基金累计收益 + 股票累计收益' },
		});
		profit.style.color = profitColor(overview.totalProfit);
		// 年化与今日盈亏仅统计基金：没有基金持仓时不显示，含股票时由 title 注明口径
		if (overview.fundCount > 0) {
			const ann = el.createSpan({
				text: `年化 ${fmtPercent(overview.annualized, 2, true)}`,
				cls: 'inv-sb-seg',
				attr: { title: '年化仅统计基金，股票不计入' },
			});
			ann.style.color = profitColor(overview.annualized);

			// 本日收益：标签跟随行情日期（当日显示「今日」，净值口径回退时显示该净值日 MM-DD）；
			// 交易时段由数据流共享输出位用估值口径原地刷新（含标签）
			const today = el.createSpan({
				cls: 'inv-sb-seg',
				attr: { title: '今日盈亏仅统计基金，股票不计入' },
			});
			const todayLabel = today.createSpan({
				text: todayProfitDateLabel(overview.todayProfitDate),
				cls: 'inv-sb-label',
			});
			const todayVal = today.createSpan({ text: fmtSignedMoney(overview.todayProfit) });
			todayVal.style.color = profitColor(overview.todayProfit);
			this.todayUnsub = this.store.todayMonitor.register({ valueEl: todayVal, labelEl: todayLabel });
		}

		// 有持仓但行情不可用的股票：点名提示，避免资产缺口被静默吞掉
		if (overview.unpricedStockCount > 0) {
			el.createSpan({
				text: `${overview.unpricedStockCount} 只股票无行情，未计入`,
				cls: 'inv-sb-extra inv-sb-missing',
			});
		}

		// 有记录但加载失败、未纳入汇总的基金：状态栏点名，避免资产缺口被静默吞掉
		renderFundFailureLine(el, s.failedFunds, this.failureHandlers());

		// 未处理买卖信号数字徽标：点击弹出处理弹窗；仅交易日 13:00 之后统计显示
		const unhandled = isSignalWindow() && s.tradingDay
			? signals.filter((sig) => this.store.getSignalStatus(sig.code) === null)
			: [];
		if (unhandled.length > 0) {
			const badge = el.createSpan({
				cls: 'inv-sb-signal',
				attr: { title: `${unhandled.length} 条买卖信号待处理，点击处理` },
			});
			badge.addEventListener('click', () => new SignalModal(this, signals).open());
			setIcon(badge, 'bell');
			badge.createSpan({ text: String(unhandled.length), cls: 'inv-sb-signal-count' });
		}
		if (s.error) el.createSpan({ text: s.error, cls: 'inv-sb-extra' });
	}

	/** 底层数据委托给数据流中枢（逻辑单源） */
	getSignalStatus(code: string): SignalStatus | null {
		return this.store.getSignalStatus(code);
	}

	/** 底层数据委托给数据流中枢（逻辑单源） */
	markSignal(code: string, status: SignalStatus): void {
		this.store.markSignal(code, status);
	}
}