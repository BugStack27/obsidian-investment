---
date: 2026-10-26
description: 汇总卡 / 状态栏口径：股票持仓并入总资产与累计收益，加载失败的基金显式点名
status: accepted
---

# 汇总口径与失败可见性 — 决策记录

> 状态：✅ 已验收（2026-11-02）

## 1. 目标与范围

让总览数据既不漏算也不静默消失：① 股票持仓的市值与累计收益并入总资产 / 累计收益，卡面注明基金专有口径；② 区分「本来就没记录」与「有记录但加载失败」，失败基金清单在汇总卡、状态栏、近期操作弹窗点名并支持打开笔记与重试。不做股票年化、不做股票今日盈亏并入，不改动 `fundCount` 语义与信号计算链路。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 股票口径来源 | 把 `summarizeStockHolding` 下沉到 `stockPortfolio` 服务，新增全库汇总 `collectStockPortfolio` | 记录块与汇总卡复用同一套持仓推导 |
| 股票扫描规则 | 与 `collectStockRecentTrades` 一致：frontmatter `stock_code` + `stock-investment`、同代码取首篇、每篇取首个 `stock-record`、异常跳过 | 保证「近期操作」与「持仓汇总」看到同一批笔记 |
| 行情缺失 | 计入 `unpricedCount`，不计资产与收益，卡面点名「N 只股票无行情」 | 静默按 0 会让看板低报 |
| 已清仓 | 数量为 0 仍计已兑现收益，但不再请求行情 | 收益已实现，行情无意义 |
| 总资产拆分 | `PortfolioOverview` 保留 `fundAssets` 作基金基数，`totalAssets` = 基金 + 股票 | 今日涨跌幅分母必须仍是基金 |
| 今日盈亏 / 年化 | 只统计基金，`applyEstimatedTodayProfit` 不混入股票 | 股票无实时估值与组合现金流 |
| 侧栏列表 | 基金卡片后追加股票卡片（最新价 / 收益 / 收益率），移除顶部「全部基金」标题 | 只有股票时也能看明细 |
| 失败判定 | 仅「有有效记录但净值 / 读取 / 汇总失败」算失败；无记录块或仅注释视为无记录、不点名 | 刚新建的基金笔记被点名属噪音 |
| 失败原因粒度 | 四类归一化短原因（净值获取失败 / 无净值数据 / 笔记读取失败 / 持仓汇总失败），原始报错只进 `title` | 原始报错长度不可控 |
| 失败展示 | 汇总卡与状态栏一行「N 只基金未纳入统计」+ 悬浮名单；操作弹窗常驻提示条逐条列出名称 + 代码 + 原因 | 避免长名单撑开底行；列表为空时也要提示 |
| 失败交互 | 点击计数行或基金行打开笔记；「重新加载」= 一次 `store.refresh()` | 净值失败不写缓存，重试即恢复 |
| 全失败空态 | 卡片数为 0 时直接列失败清单；`s.error` 仍优先显示 | 「还没有任何基金持仓」与事实不符 |
| 计数口径 | `fundCount` 仍只统计成功基金 | 「共 N 只」语义不变，缺口由失败行承担 |
| 清单刷新 | 仅全量刷新重算；盘中估值与信号刷新沿用上一轮 | 轻量路径不额外拉净值 |
| 兼容 | `loadFundAnalysis` 保持原签名，改为结果类型的薄封装 | `listHeldFunds`、可卖份额逻辑零改动 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/services/stockPortfolio.ts` | 迁入 `StockHoldingSummary` / `summarizeStockHolding`；新增 `collectStockPortfolio` 与 `StockCard` |
| `src/services/fundAnalysis.ts` | `FundLoadFailure` / `FundAnalysisResult` 与 `loadFundAnalysisResult`：读取、净值、汇总三段独立兜底 |
| `src/services/portfolioOverview.ts` | `PortfolioOverview` 增加 `fundAssets` / `stockAssets` / `stockProfit` / `stockCount` / `unpricedStockCount`；`applyStockPortfolio`；`buildFundCards` 收集 `failedFunds` |
| `src/data/investmentStore.ts` | `StoreSnapshot` 新增 `failedFunds`；`refresh()` 合并股票汇总，股票失败不阻断基金链路 |
| `src/ui/stockRecordBlock.ts` | 改为从服务层导入持仓推导 |
| `src/ui/fundFailureNotice.ts` | 失败计数行、悬浮菜单与提示条渲染 |
| `src/ui/summaryCard.ts` | 涨跌幅分母改用 `fundAssets`；含股票计数与口径说明；失败计数行 |
| `src/ui/fundView.ts` | 只有股票时也渲染汇总卡；基金后追加股票卡片；全失败时用提示块替代空态 |
| `src/main.ts` | 状态栏总资产 / 累计收益含股票，年化与今日盈亏保持基金口径并加 `title`；失败行优先级 |
| `src/ui/recentTradesModal.ts` | 失败提示条与空态文案（今日档 / 近 N 天档分档） |
| `src/ui/stockRecordBlock.ts`、`styles.css`、`README.md` | 股票卡片、样式与文档口径同步 |

## 4. 关键修正与教训

- **股票按 0 价计入会低报总资产** → 行情为 `null` 时只计 `unpricedCount`，资产与收益都不累加。
- **今日涨跌幅若沿用含股票的总资产** → 分母与分子（基金估值）口径不一致，必须改用 `fundAssets`。
- **只有股票没有基金时，原空态判断会让看板整块消失** → 空态条件改为「基金与股票都没有」。
- **股票扫描与近期操作若各写一套去重规则** → 同一代码多篇笔记会出现重复资产，必须共用首篇 / 首块规则。
- **三种 `null` 合一** → 调用方无法区分，失败基金静默消失；改为「ok / no-record / failed」结果联合类型。
- **操作弹窗空态与「已记录」Notice 自相矛盾** → 有失败基金时空态文案改为「已纳入统计」口径。
- **Obsidian `Menu` 无 tooltip API** → 原始报错只能放在计数行与提示条行的 `title` 上。
- **失败清单若跟随估值刷新重算** → 盘中会额外拉净值；改为只在全量刷新重算。
- **名称回退需分两套** → 失败清单回退 `file.basename`，ok 路径沿用 `code` 回退。

## 5. 已知边界

- 全部股票都无行情时 `stockCount=0`，底行显示「共 0 只」，同时卡底点名无行情股票。
- 股票持仓按记录块买卖推导，不含券商侧手续费差异与分红再投资细节。
- 无记录块或记录块仅注释的基金永不被点名，也不进入清单。
- 失败基金仍参与实时估值批量请求；失败期间该基金无卡片、无图表。
- 今日盈亏与信号计算链路口径不变。
- 本次未在 Obsidian 内做人工 UI 走查。

## 6. 后续候选

- 暂无。
