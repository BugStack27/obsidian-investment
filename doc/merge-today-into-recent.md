---
date: 2026-10-28
description: 将「今日操作」合并进「近期操作」：新增今日档并保留持有金额视角，删除今日弹窗、旧命令与快照冗余字段
status: accepted
---

# 今日操作合并进近期操作 — 决策记录

> 状态：✅ 已验收（2026-10-28）

## 1. 目标与范围

`todayTrades` 本就是 `recentTrades` 中 `date === today` 的子集，两个弹窗共用 `renderTradeSummary` / `renderTradeTable`，仅差「持有金额」一列。本次合并为单一「近期操作」弹窗，用「今日」窗口档承载原权重视角，并删除今日弹窗、旧命令与快照冗余字段，形成单一数据源、单一入口。不改分红口径、盘中估值刷新、失败基金提示、`记一笔买卖`、点击跳转与跨零点行为；不改 `manifest.json` 版本号。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 今日视角承载方式 | 新增「今日」档（1 天窗口）并保留「持有金额」列 | 权重视角完整保留，其余日期列不变 |
| 旧命令 `show-today-trades` | 删除，不保留别名 | 今日视角在弹窗内切换即可，入口唯一 |
| 今日组排序 | 买入组 → 卖出组，组内按持有金额（持仓市值）降序 | 保持原今日弹窗口径，零迁移成本 |
| 持有金额列与排序作用范围 | 仅「今日」档启用；7/30/90 档仍 7 列并走 `sortRecentTrades` | 按不展示的列排序无法向用户解释，同视图内各组列数应一致 |
| `StoreSnapshot.todayTrades` | 删除，今日列表由弹窗从 `recentTrades` 派生 | 快照不再保留两份互相派生的事实 |
| 派生成本 | `sortTodayTrades` 在渲染时调用（纯内存） | 无需额外刷新链路 |
| 默认窗口 | 仍为 30 天 | 删除命令后无深链需求，30 天首屏即含今日分组 |
| 工具栏文案 | `今日` / `7 天` / `30 天` / `90 天` | 「今日」比「1 天」更贴近语义 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/recentTradesModal.ts` | `RANGE_OPTIONS` 改四档 `{days,label}`；`COLUMNS` 与 `COLUMNS_WITH_HOLD`；`renderGroup(columns, showHoldValue)`；今日档调用 `sortTodayTrades`；窗口/失败提示/空态/底部说明分档文案 |
| `src/ui/todayTradesModal.ts` | 已删除 |
| `src/main.ts` | 移除 `TodayTradesModal` 引用与 `show-today-trades` 命令；`show-recent-trades` 不变 |
| `src/data/investmentStore.ts` | 删除 `StoreSnapshot.todayTrades`、初始 state、`refresh()` 派生与三处 `emit` 字段、`sortTodayTrades` 导入 |
| `src/services/todayTrades.ts` | 保留 `sortTodayTrades` / `summarizeTodayTrades` 与 `TodayTrade` 契约，函数体不改，今日档唯一消费者为 `recentTradesModal` |
| `src/services/portfolioOverview.ts`、`recentTrades.ts`、`tradeList.ts`、`fundFailureNotice.ts`、`settings.ts` | 注释与设置项措辞统一为「今日档 / 近期操作」 |
| `styles.css` | 删除 `.inv-today-trades-modal`、`.inv-today-head/date/count`；保留 `.inv-today-body` 等共享样式，分区注释改为操作记录弹窗（近期/今日档共享） |
| `README.md` | 「今日操作」与「近期操作」合并为一条，命令表删除旧命令 |

## 4. 关键修正与教训

- **今日档 8 列、其余档 7 列** → 列序与合并前今日弹窗逐字一致（类型/标的/金额/持有金额/份额·数量/参考净值/手续费/备注），`renderGroup` 需显式接收列定义与是否显示持有金额。
- **合并后排序可能与旧弹窗不一致** → `days === 1` 窗口天然只含今日，由 `recentTrades` 重排的结果与旧 `todayTrades` 逐条等价；这是删除快照字段的前提。
- **文案混用会造成口径矛盾** → 今日档窗口文案 `YYYY-MM-DD · N 条`、失败提示「其今日的…」、空态「今日暂无…」，其余档维持「近 N 天…」。
- **`todayTrades` 无消费者才能删** → 数据层收敛必须晚于弹窗与命令删除，否则编译期即暴露引用。
- **估值刷新不应重绘列表** → 今日档沿用既有跳过策略，`estimate` 更新不触发整表重绘。

## 5. 已知边界

- 股票当日行情请求保留，用于今日档的持有金额；行情不可得时该格显示 `—` 并置底。
- 分红不计入列表，与合并前一致。
- 跨零点行为未处理：弹窗停留跨日不会自动把「今日」档切到新的一天。
- 旧今日弹窗的样式类已删除，第三方自定义 CSS 若引用会失效。

## 6. 后续候选

- 暂无。
