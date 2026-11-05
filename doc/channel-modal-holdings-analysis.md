---
date: 2026-10-15
description: 指标分析弹窗新增「持仓分析」页签：重仓股 PE/PB/PE×PB 柱状图（缩放联动、手动补充、历史对比与阈值分布），并复用到买卖信号弹窗
status: accepted
---

# 指标分析弹窗持仓分析 — 决策记录

> 状态：✅ 已验收（2026-10-15）

## 1. 目标与范围

在指标分析弹窗右栏新增「持仓分析」页签：前十大重仓股的 PE/PB/PE×PB 柱状图，叠加参考线，支持横轴缩放滚动与三图联动，持仓可手动补充；同一套视图复用到买卖信号弹窗右列。后续在同一页签内补齐「当前 vs 历史日期」对比分析、阈值市值占比统计与逐图分析提示窗。不做：债券持仓入图、历史持仓快照、旧 settings 数据迁移。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 布局 | 右栏「趋势通道 / 持仓分析」页签切换，弹窗宽高不变 | 避免多图纵向挤压（用户否决堆叠与并排） |
| 加载时机 | 懒加载：切入持仓页签才拉行情，按基金缓存在视图实例 | 打开快、请求少，关闭即释放 |
| 数据链路 | `fund.profile` 的 holdings 只有 code/marketId → `quotes.cn` 一次批量取 PE(TTM)/PB/名称/市值 | SDK 的 profile 不含估值；批量合并为单请求 |
| 缺失值 | 柱置 `null` 不画柱，轴底灰色空心圆占位，tooltip 说明 | 用户否决「跳过」与「按 0」 |
| 排序 | 按值降序、`null` 最后，**三图共用同一顺序** | 联动缩放要求同一窗口位置对应同一只股票 |
| 缩放 | dataZoom 绑 **x 轴**（滚轮/拖动 + 底部滑块），默认 filter 模式 | 窗外分类移除后 y 轴按可见柱自动重算；y 轴缩放会整根删柱 |
| 联动 | echarts connect，分组名**按视图实例唯一** | 同时打开的两个弹窗是不同基金，禁止跨弹窗误联动 |
| 手动持仓 | 存笔记 `fund-holding` 代码块（CSV），**不用插件设置** | 跟笔记走、可手改；「是/y/true/1」才参与图表，重复代码保留首行 |
| 合并策略 | 自动前十大 + 手动「当前持仓」行去重合并，手动行补名称与比例 | 补充而非覆盖；自动为空时允许手动-only |
| 录入交互 | 「编辑持仓…」→ 搜索添加 + 表格编辑比例/当前持仓/删除 | 用户指定搜索式录入（否决内联输入框） |
| 信号弹窗 | 右列同页签，先点「分析」确定当前基金 | 用户否决通道图下方堆叠 |
| 对比形态 | 选日期后三图变「当前 vs 当时」分组柱，PE×PB 对比值 = 当时 PE×PB | PB 与 PE 同源（一次返回 PE_TTM + PB_MRQ），一并支持 |
| 历史数据源 | 东财 `RPT_VALUEANALYSIS_DET`，`TRADE_DATE<=日期` 倒序取最近一行；`requestUrl` + 按 `code:date` 6h 缓存 | SDK 未封装历史估值；renderer 内 fetch 受 CORS 限制 |
| 对比容错 | 单只无数据该股对比柱为空；全部失败走重试态；`compareDate` 跨基金保持 | 上市晚于所选日期的老股票本就无数据 |
| 统计口径 | 阈值市值占比按持仓市值（PE<15/30、PB<1.5/3、PE×PB<22.5/45），对比模式下同时给「当前」与「当时」 | 与各图参考线一一对应 |
| 结论语义 | 统一「当时 → 当前」方向，delta 仍为「当前 − 当时」 | 原方向写反，出现 `2.50→49.13` 却标「下降」 |
| 分析入口 | **已于 2026-11-04 移除**；原为每张图右上「分析」按钮 + 悬浮提示窗 | 阈值占比与只数已由安全度卡直接展示，按钮信息重复且遮挡图区 |
| 参考线 | PE 15/30、PB 1.5/3、PE×PB 22.5/45，低绿高红虚线 | 沿用「低估值绿、高估值红」约定；PB 原为 1/2 于 2026-11-04 调为 1.5/3（破净股占比过低导致子项恒定），PE×PB 同批由 30/60 调为 22.5/45（22.5 = 15×1.5 格雷厄姆标准） |
| 缓存边界 | 缓存只存不含对比值的基础数据，对比值每次现算 | 避免缓存被某次对比日期污染 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/services/stockSdk.ts` | `fetchFundProfile` 透传 holdings；`fetchStockValuations` 批量估值；`fetchStockValuationAt` 历史估值快照 |
| `src/services/fundHoldings.ts` | `loadFundHoldingsAnalysis` 自动+手动合并；`computeThresholdStats` / `computeSafetyScore` 纯函数统计（`computeValuationCompareStats` 仍在，计算平均估值变化，当前无 UI 使用） |
| `src/utils/holdingBlock.ts` | `fund-holding` 代码块的解析、序列化与读写（无块时追加到末尾） |
| `src/ui/charts/holdingsValuation.ts` | `buildHoldingsPeOption` / `buildHoldingsPbOption` / `buildHoldingsPepbOption` + `sortHoldingsByValue`；可选 `compare` spec |
| `src/ui/holdingsValuationView.ts` | `HoldingsValuationView`：懒加载缓存、竞态令牌、三图 connect、置顶控制行、安全度卡 |
| `src/ui/fundHoldingEditModal.ts` | `FundHoldingEditModal`：搜索添加 + 表格编辑，保存写回代码块 |
| `src/ui/charts/echartsInit.ts` | 按需注册表增加 `BarChart` |
| `src/ui/channelModal.ts` | 右栏页签 + 持仓 pane 委托视图 |
| `src/ui/signalModal.ts` | 右列页签复用同一视图，「分析」记录当前基金 |
| `src/settings.ts` | 仅保留 trendChannelConfig，`holdingsExtra` 已移除 |
| `styles.css` | 页签、`.inv-holdings-*`、`.inv-holdings-control*`、`.inv-holdings-safety*`、`.inv-holding-edit-*` |

## 4. 关键修正与教训

- **BarChart 未加入 `echarts.use`** → 运行时报错；新图表类型必须先改 `echartsInit`。
- **bar 图做 y 轴 zoom** → 默认 filter 会整根删柱、丢失「特别高」的信息；正确姿势是 x 轴 zoom + filter，y 自适应。
- **connect 联动需两前提** → 各图分类数组完全同序 + 分组名按视图实例唯一（两个弹窗同开时共用组名会跨弹窗误联动）。
- **隐藏容器里初始化 echarts 得 0 尺寸** → 页签隐藏时跳过创建，切回时重建/resize。
- **弹窗内懒加载存在竞态** → 令牌 + `pane.isConnected` 双校验，过期结果丢弃。
- **renderer 内 `fetch` 受 CORS 限制且被 lint 拦** → 插件内 HTTP 一律用 `requestUrl`。
- **缓存混入对比值会被某次日期污染** → 缓存只存基础数据，对比值合并为副本。
- **结论方向与 delta 不一致** → 文案按「当时 → 当前」书写，delta 仍取「当前 − 当时」。
- **用户反馈「新功能看不到」** → 先查插件是否重载；hot-reload 不会刷新已打开的弹窗（旧 DOM 残留）。

## 5. 已知边界

- 手动代码仅支持 A 股（`quotes.cn` 无港股/美股行情），填错显示灰色占位。
- 重仓股来自最新报告期，滞后实际持仓约一季；比例仅手动行有值。
- 旧 `settings.holdingsExtra` 自动失效，未做迁移。
- 信号弹窗需先点信号卡片「分析」才有基金上下文，此前页签显示引导文案。
- 只能「当前持仓回看历史」，无历史持仓快照；所选日期早于个股上市日则该股无对比柱。
- 单只 PE 特别高时需手动缩放横轴排除，未做自动截断。

## 6. 后续候选

- PB 图是否改按 PB 自身排序（当前三图统一按 PE 降序以支持联动）。
- 纵轴 y-zoom（`weakFilter` 裁切模式）作为备选交互。
