---
date: 2026-09-11
description: 指标分析弹窗：左栏持仓基金切换、右栏趋势通道 / 持仓分析页签、重仓股估值图、历史对比、阈值统计与安全度评分
status: accepted
---

# 指标分析弹窗 — 决策记录

> 状态：✅ 已验收（2026-11-04）

## 1. 目标与范围

把只服务单只基金的 `ChannelModal` 扩展为「左栏持仓基金 + 右栏指标分析」：左栏点击即在同一弹窗内切换基金；右栏在「趋势通道 / 持仓分析」两个页签间切换。持仓分析页签提供前十大重仓股 PE / PB / PE×PB 柱状图、缩放联动、手动补充、当前 vs 历史对比、阈值市值占比与安全度评分，并复用到买卖信号弹窗。不做债券持仓入图、不做历史持仓快照、不做旧 settings 迁移、不做评分历史趋势与行业分档阈值。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 左栏范围 | 仅 `holdShares > 0` 的持有基金，按 code 去重、按名称 `localeCompare(..., 'zh')` 排序 | 清仓基金无需对比，列表越短切换越快 |
| 默认选中 | 跟随当前笔记 `initialCode`，否则选第一只；命令入口无上下文时同样选第一只 | 从笔记进入无需二次点击，命令零配置可用 |
| 数据加载 | 打开时一次性取全部持仓基金明细；切换为纯内存重绘；参数按 `settings.trendChannelConfig[code]` 分基金持久化 | 切换体验优先，净值已有缓存，持仓数量有限 |
| 布局 | 双栏，弹窗宽 `min(880px, 92vw)`，左栏 148px；≤720px 时左栏降级为顶部横向滚动 | 窄窗口下图表仍可用 |
| 右栏结构 | 「趋势通道 / 持仓分析」页签切换，弹窗宽高不变 | 避免多图纵向挤压（堆叠与并排方案被否） |
| 持仓页加载 | 懒加载：切入页签才拉行情，按基金缓存在视图实例，关闭即释放 | 打开快、请求少 |
| 估值数据链路 | `fund.profile` 的 holdings 只有 code/marketId → `quotes.cn` 一次批量取 PE(TTM) / PB / 名称 / 市值 | SDK profile 不含估值，批量合并为单请求 |
| 历史估值 | 东财 `RPT_VALUEANALYSIS_DET`，`TRADE_DATE <= 日期` 倒序取最近一行；`requestUrl` + 按 `code:date` 6h 缓存 | SDK 未封装历史估值，renderer 内 fetch 受 CORS 限制 |
| 缺失值 | 柱置 `null` 不画柱，轴底灰色空心圆占位，tooltip 说明 | 「跳过」与「按 0」均被否决 |
| 排序 | 按值降序、`null` 最后，三图共用同一顺序 | 联动缩放要求同一窗口位置对应同一只股票 |
| 缩放 | `dataZoom` 绑 x 轴（滚轮/拖动 + 底部滑块），默认 filter 模式 | 窗外分类移除后 y 轴按可见柱自动重算；y 轴缩放会整根删柱 |
| 联动 | echarts connect，分组名按视图实例唯一 | 两个弹窗是不同基金，禁止跨弹窗误联动 |
| 手动持仓 | 存笔记 `fund-holding` 代码块（CSV），不用插件设置；布尔真值才参与图表，重复代码保留首行 | 跟笔记走、可手改 |
| 合并策略 | 自动前十大 + 手动「当前持仓」行去重合并，手动行补名称与比例 | 补充而非覆盖；自动为空时允许手动-only |
| 录入交互 | 「编辑持仓…」→ 搜索添加 + 表格编辑比例 / 当前持仓 / 删除 | 搜索式录入（内联输入框被否） |
| 对比形态 | 选日期后三图变「当前 vs 当时」分组柱，PE×PB 对比值 = 当时 PE×PB | PB 与 PE 同源（一次返回 PE_TTM + PB_MRQ） |
| 结论语义 | 文案统一「当时 → 当前」，delta 仍为「当前 − 当时」 | 原方向写反，出现数值下降却标「下降」的矛盾 |
| 阈值与参考线 | PE 15/30、PB 1.5/3、PE×PB 22.5/45，低绿高红虚线 | 低估值绿、高估值红；PB 原 1/2 因破净股占比过低调整，PE×PB 取 15×1.5 格雷厄姆标准 |
| 阈值统计 | 按持仓市值占比（`belowCap / totalCap`），对比模式同时给「当前」与「当时」 | 反映真实资金暴露，与参考线一一对应 |
| 安全度评分 | 谨慎 = `0.5·PE<15 + 0.3·PB<1.5 + 0.2·PE×PB<22.5`；激进 = `0.5·PE<30 + 0.3·PB<3 + 0.2·PE×PB<45` | PE 主口径；PB 与 PE 非独立维度，权重下调至 30% |
| 评分口径 | 市值加权；只数占比作灰字副信息；无数据子项权重在剩余子项内归一化 | 不按 0 分，避免全无 PE 的基金被判「极度危险」 |
| 覆盖度 | 子卡底部「覆盖 x% 市值」，仅 <100% 时渲染 | 提示评分分母不完整（亏损股被剔除会让分数虚高） |
| 色阶 | ≥75 安全 / 50–74 中性 / 25–49 偏险 / <25 危险，颜色挂 `--s-color` 变量并适配浅色主题 | 拉开亮度而非仅色相，深色主题下黄与橙相邻难分 |
| 布局顺序 | 控制行置顶 → 安全度卡（标题 + 4 列网格）→ 三图；顶部说明行删除 | 用户指定控制行在卡上方，说明文字并入覆盖度行 |
| 分析按钮 | 每图右上「分析」按钮与悬浮提示窗已于 2026-11-04 移除 | 阈值占比与只数已由安全度卡直接展示，按钮重复且遮挡图区 |
| 缓存边界 | 缓存只存不含对比值的基础数据，对比值每次现算 | 避免缓存被某次对比日期污染 |
| 信号弹窗 | 右列同页签，先点「分析」确定当前基金后才展示持仓分析 | 通道图下方堆叠方案被否 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/services/fundAnalysis.ts` | `FundAnalysisData`、`loadFundAnalysis`、`listHeldFunds`；失败原因上报 |
| `src/services/stockSdk.ts` | `fetchFundProfile` 透传 holdings；`fetchStockValuations` 批量估值；`fetchStockValuationAt` 历史快照 |
| `src/services/fundHoldings.ts` | `loadFundHoldingsAnalysis` 自动 + 手动合并；`computeThresholdStats`、`computeSafetyScore`、`weightedSafetyScore` |
| `src/utils/holdingBlock.ts` | `fund-holding` 代码块解析、序列化与读写 |
| `src/ui/charts/holdingsValuation.ts` | `buildHoldingsPeOption` / `buildHoldingsPbOption` / `buildHoldingsPepbOption`、`sortHoldingsByValue`、可选 `compare` |
| `src/ui/holdingsValuationView.ts` | 页签视图：懒加载缓存、竞态令牌、三图 connect、控制行、安全度卡 |
| `src/ui/fundHoldingEditModal.ts` | 搜索添加 + 表格编辑，保存写回代码块 |
| `src/ui/charts/echartsInit.ts` | 按需注册增加 `BarChart` |
| `src/ui/channelModal.ts` | 左栏切换、右栏页签、`costInfo` 与持仓 pane 委托 |
| `src/ui/signalModal.ts` | 右列页签复用同一视图 |
| `src/services/portfolioOverview.ts` | `buildFundCards` 复用 `loadFundAnalysisResult` |
| `styles.css` | 双栏、页签、`.inv-holdings-*`、安全度、编辑弹窗与色阶 |

## 4. 关键修正与教训

- **BarChart 未加入 `echarts.use`** → 运行时报错；新图表类型必须先改 `echartsInit`。
- **bar 图做 y 轴 zoom** → 默认 filter 会整根删柱；正确姿势是 x 轴 zoom + filter，y 自适应。
- **connect 联动需两前提** → 各图分类数组完全同序 + 分组名按视图实例唯一。
- **隐藏容器里初始化 echarts 得 0 尺寸** → 页签隐藏时跳过创建，切回时重建 / resize。
- **弹窗内懒加载存在竞态** → 令牌 + `pane.isConnected` 双校验，过期结果丢弃。
- **renderer 内 `fetch` 受 CORS 限制且被 lint 拦** → 插件内 HTTP 一律用 `requestUrl`。
- **缓存混入对比值会被某次日期污染** → 缓存只存基础数据，对比值合并为副本。
- **阈值不能脱离分布谈** → 固定 PB 阈值隐含「所有公司 ROE 相同」假设，行业集中就退化；先看达标只数再定阈值。
- **权重分配要承认指标相关** → PB 与 PE 同源于盈利与净资产，等权会重复计价。
- **卡片等高靠 `margin-top: auto`** → 覆盖度行条件渲染导致子卡高度不一，用弹性沉底对齐。
- **切换基金后参数控件叠加** → `buildParamControls` 每次清空重建，控件数量恒定。
- **用户反馈「新功能看不到」** → 先确认插件已重载；hot-reload 不会刷新已打开的弹窗。

## 5. 已知边界

- 手动代码仅支持 A 股（`quotes.cn` 无港股 / 美股行情），填错显示灰色占位。
- 重仓股来自最新报告期，滞后实际持仓约一季；比例仅手动行有值。
- 只能「当前持仓回看历史」，无历史持仓快照；所选日期早于个股上市日则该股无对比柱。
- 绝对阈值不区分行业与个股 ROE；只数占比不参与评分。
- 首次打开需等待全部持仓基金加载完成，持仓数量大时首屏变慢。
- 单只基金加载失败被静默跳过，表现为列表少一项。
- 信号弹窗需先有基金上下文，此前页签显示引导文案。
- 单只 PE 特别高时需手动缩放横轴排除，未做自动截断。

## 6. 后续候选

- PB 图是否改按 PB 自身排序（当前三图统一按 PE 降序以支持联动）。
- 纵轴 y-zoom（`weakFilter` 裁切模式）作为备选交互。
- 收紧阈值或引入行业分档，改善跨行业可比性。
