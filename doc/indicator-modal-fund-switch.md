---
date: 2026-09-11
description: 指标分析弹窗改为左栏持仓基金列表 + 右栏指标分析，支持弹窗内快速切换基金；新增「打开指标分析」命令
status: accepted
---

# 指标分析弹窗改造 — 决策记录

> 状态：✅ 已验收（2026-09-11）

## 1. 目标与范围

把原先只服务单只基金的 `ChannelModal` 改为左右双栏：左栏列出当前持有中的基金（仅名称），右栏保留趋势通道图、参数配置与买卖信号，点击左栏即在同一弹窗内切换。新增命令入口，无需打开基金笔记即可使用。不涉及收益卡片、定投对比弹窗与图表本身的算法。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 左栏范围 | 仅 `holdShares > 0` 的持有基金，按 code 去重、按名称 `localeCompare(..., 'zh')` 排序 | 清仓基金无需对比，列表越短切换越快 |
| 列表项内容 | 仅基金名称 | 满足切换诉求，最简洁 |
| 默认选中 | 跟随当前笔记：`initialCode` 命中则选中，否则选第一只 | 从笔记进入时无需二次点击 |
| 命令无上下文 | 照常打开并选中第一只 | 命令入口零配置可用 |
| 数据加载 | 弹窗自带加载，打开时一次性取全部持仓基金明细；切换为纯内存重绘 | 切换体验优先；净值已被 `stockSdk` 缓存，持仓数量有限 |
| 加载占位 | 加载中/空持仓在右栏给出文案 | 避免空白弹窗 |
| 参数配置 | 仍按 `settings.trendChannelConfig[code]` 分基金持久化，切换后读回该基金配置 | 各基金参数互不覆盖 |
| 重复逻辑 | `buildFundCards` 复用同一加载管线（`loadFundAnalysisResult`），删除本地同构扫描 | 避免两套管线漂移，同时保留失败原因上报 |
| 样式 | 弹窗宽度放宽至 `min(880px, 92vw)`，左栏 148px；≤720px 时左栏降级为顶部横向滚动 | 保证窄窗口下图表仍可用 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/services/fundAnalysis.ts`（新建） | `FundAnalysisData` 类型；`firstHeading`；`loadFundAnalysis`（cachedRead → getFirstRecordInner → parseRecordSource → fetchFundNavHistory → resolvePending → summarizeHolding，失败返回 null）；`listHeldFunds` |
| `src/services/portfolioOverview.ts` | `buildFundCards` 逐只基金改用 `loadFundAnalysisResult`，卡片字段与返回结构不变 |
| `src/ui/channelModal.ts` | `ChannelModalProps` 精简为 `{ initialCode }`；双栏 DOM、`select()` 切换与右栏重绘、按 code 读写参数 |
| `src/ui/charts/index.ts` | `ChartsProps`；`analysisBtn` 改为 `new ChannelModal(plugin, { initialCode: props.code })` |
| `src/main.ts` | 命令 `open-indicator-analysis`（「打开指标分析」），复用 `activeFundCode()` |
| `styles.css` | `.inv-channel-layout` / `.inv-channel-sidebar` / `.inv-channel-fund-item(.active)` / `.inv-channel-main` 及窄屏降级 |

## 4. 关键修正与教训

- **异步加载期间弹窗被关闭** → `listHeldFunds` 返回后先判断弹窗是否仍打开，否则直接 return，避免操作已销毁的 DOM。
- **切换基金后参数控件叠加** → `buildParamControls` 每次清空重建，控件数量恒定。
- **`.inv-channel-header` 被当作本弹窗专属** → 定投对比弹窗也在复用，保留并修正而非删除。
- **`buildFundCards` 复用后行为偏移风险** → `codes.push` 仍在加载前执行、单只失败 `continue` 不中断循环，卡片字段与返回结构保持不变。

## 5. 已知边界

- 首次打开需等待全部持仓基金加载完成，持仓数量大时首屏变慢；切换阶段不再发请求，净值也不重新拉取。
- 左栏无搜索、无排序切换，顺序固定为名称升序。
- 单只基金加载失败（非基金笔记、无记录、请求失败）被静默跳过，仅表现为列表少一项。

## 6. 后续候选

- 暂无。
