---
date: 2026-11-02
description: 把股票持仓的市值与累计收益并入状态栏 / 侧栏汇总的总资产与累计收益，并在卡面注明基金专有口径
---

# 汇总口径并入股票持仓 - 任务规划

## 需求概述

同一份笔记库里既有基金笔记也有股票笔记，但状态栏与侧栏汇总卡的总资产、累计收益、年化只由基金卡片求和，股票持仓在总览里完全缺席，看板会系统性少算一截。本次复用股票记录块的持仓汇总口径（`summarizeStockHolding`）与行情缓存（`fetchStockQuote`），在全量刷新时额外汇总股票市值与累计收益并入总资产 / 累计收益；年化与今日盈亏仍只统计基金，但必须在卡面写明口径，避免把「股票不计入」误读成「没有股票」。股票行情不可得时不静默按 0 计入，而是点名未纳入数量。

## Requirements

### 1. 股票持仓汇总下沉为共享服务

| 属性 | 值 |
|------|-----|
| **目标** | 把 `StockHoldingSummary` 与 `summarizeStockHolding` 从 UI 层移到服务层，新增全库股票持仓汇总 `collectStockPortfolio`，供汇总卡链路复用；股票记录块行为零变化 |
| **涉及文件** | 新增 `src/services/stockPortfolio.ts`；修改 `src/ui/stockRecordBlock.ts` |
| **验收标准** | ① `stockRecordBlock` 改为从服务层导入，删除本地类型与函数，渲染/统计逻辑不变；② `collectStockPortfolio(app)` 返回 `{ stockCount, totalAssets, totalProfit, unpricedCount }`，扫描规则与 `collectStockRecentTrades` 一致（frontmatter `stock_code` + `stock-investment`、同代码只取首篇、每篇只取首个 `stock-record` 块、异常跳过）；③ 持仓数量 > 0 时经 `fetchStockQuote`（60s 缓存）取值，行情为 null 的计入 `unpricedCount` 且不计入资产与收益；已清仓（数量为 0）仍计入已兑现收益、但不再请求行情；④ `npm run build` 与 `npm run lint` 通过 |
| **依赖** | 无 |

### 2. 汇总快照并入股票市值与累计收益

| 属性 | 值 |
|------|-----|
| **目标** | 扩展 `PortfolioOverview`，在全量刷新时把股票汇总并入 `totalAssets` / `totalProfit`，同时保留基金口径的资产基数，供今日涨跌幅分母使用 |
| **涉及文件** | `src/services/portfolioOverview.ts`、`src/data/investmentStore.ts` |
| **验收标准** | ① `PortfolioOverview` 新增 `fundAssets`（基金市值，恒等于原 `totalAssets`）、`stockAssets`、`stockProfit`、`stockCount`、`unpricedStockCount`，`EMPTY_OVERVIEW` 同步补零；② `summarizeFundCards` 只汇总基金并写入 `fundAssets`，随后由新函数 `applyStockPortfolio` 把股票市值与收益累加进 `totalAssets` / `totalProfit`；③ `investmentStore.refresh()` 在基金链路后调用 `collectStockPortfolio` 并合并，股票扫描失败不阻断基金汇总（沿用整体 catch 语义）；④ `applyEstimatedTodayProfit` 仍只改写基金今日盈亏，不把股票混入；⑤ 只有股票、没有基金时 `overview.totalAssets` 仍为正数；⑥ `npm run build` 通过 |
| **依赖** | 1 |

### 3. 汇总卡、状态栏与侧栏的口径展示

| 属性 | 值 |
|------|-----|
| **目标** | 让总资产 / 累计收益的股票口径可解释：展示基金与股票构成，注明年化与今日盈亏仅统计基金，并对无行情的股票点名 |
| **涉及文件** | `src/ui/summaryCard.ts`、`src/main.ts`、`src/ui/fundView.ts`、`styles.css` |
| **验收标准** | ① 汇总卡「累计收益」随股票并入变化，今日涨跌幅分母改用 `ov.fundAssets`；② 底行计数在含股票时显示「基金 X 只 · 股票 Y 只」，否则保持「共 N 只」；③ 含股票时追加一行口径说明「总资产与累计收益含股票；今日盈亏与年化仅统计基金」；`unpricedStockCount > 0` 时再显示「N 只股票无行情，未纳入统计」；④ 状态栏总资产 / 累计收益含股票，年化与今日盈亏保持基金口径并带 `title` 说明；无基金只有股票时不再显示「计算中…」/「还没有任何基金持仓」，至少能看到汇总卡与总资产；⑤ 新增样式类，颜色沿用 `var(--text-muted)` 与 `var(--text-warning)`；⑥ `npm run build` 与 `npm run lint` 通过 |
| **依赖** | 2 |

### 4. README 口径同步

| 属性 | 值 |
|------|-----|
| **目标** | 用户文档同步新的汇总口径，避免文档仍写「汇总所有基金」 |
| **涉及文件** | `README.md` |
| **验收标准** | 状态栏总览与汇总卡说明补充「总资产 / 累计收益含股票；年化与今日盈亏仅统计基金；股票行情不可得时不纳入并点名」 |
| **依赖** | 3 |

## Complements

### 1. 股票持仓汇总下沉为共享服务
- **状态**：✅ 已完成
- **变更文件**：`src/services/stockPortfolio.ts`（新建：迁入 `StockHoldingSummary` / `summarizeStockHolding`，新增 `collectStockPortfolio` 全库汇总与 `StockPortfolio` 类型）、`src/ui/stockRecordBlock.ts`（删除本地实现，改为服务层导入）
- **审查结果**：通过（证据：`npx tsc -noEmit -skipLibCheck` 退出码 0；`npm run lint` 0 error）
- **完成时间**：2026-11-02 09:40

### 2. 汇总快照并入股票市值与累计收益
- **状态**：✅ 已完成
- **变更文件**：`src/services/portfolioOverview.ts`（`PortfolioOverview` 新增 `fundAssets` / `stockCount` / `stockAssets` / `stockProfit` / `unpricedStockCount`，`summarizeFundCards` 写入 `fundAssets`，新增 `applyStockPortfolio`）、`src/data/investmentStore.ts`（并行调用股票近期操作与持仓汇总，合并总览）
- **审查结果**：通过（证据：股票扫描去重与 `collectStockRecentTrades` 一致；行情失败计入 `unpricedCount` 且不按 0 价计入；`npm run build` 通过）
- **完成时间**：2026-11-02 09:48

### 3. 汇总卡、状态栏与侧栏的口径展示
- **状态**：✅ 已完成
- **变更文件**：`src/ui/summaryCard.ts`（涨跌幅分母改用 `fundAssets`、含股票计数与口径说明、无基金时「年化 —」）、`src/main.ts`（空态判断含股票、总资产/累计收益含股票、年化与今日仅基金、无行情股票点名）、`src/ui/fundView.ts`（只有股票时也渲染汇总卡）、`styles.css`（口径说明与状态栏点名样式）
- **审查结果**：通过（证据：今日盈亏分母全链路保持基金口径；只有股票/只有失败基金/空库分支均合理；`npm run lint` 0 error）
- **完成时间**：2026-11-02 09:55

### 4. README 口径同步
- **状态**：✅ 已完成
- **变更文件**：`README.md`（状态栏总览补充股票口径、无行情点名与基金专有口径说明）
- **审查结果**：通过（证据：文档与实现行为一致）
- **完成时间**：2026-11-02 09:58

### 完成总结
- 4 个变更集全部完成并通过审查；股票市值与累计收益已并入状态栏与侧栏汇总的总资产 / 累计收益，年化与今日盈亏保持基金口径并在卡面注明。
- 追加（2026-11-02）：侧栏列表在基金卡片后追加股票卡片（最新价 / 收益 / 收益率），并移除顶部「全部基金」标题。
- 已知边界：全部股票都无行情时 `stockCount=0`，底行显示「共 0 只」，同时卡底点名无行情股票；本次未在 Obsidian 内做人工 UI 走查。

