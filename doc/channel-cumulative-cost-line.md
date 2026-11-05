---
date: 2026-09-23
description: 趋势通道图与净值走势卡新增「累计成本线」，仅在累计成本高于持仓成本时叠加同色系水平参考线
status: accepted
---

# 累计成本线（条件显示） — 决策记录

> 状态：✅ 已验收（2026-09-23）

## 1. 目标与范围

在趋势通道图与净值走势卡上，当「累计成本」高于「持仓成本」时额外画一条累计成本水平参考线。累计成本 = `totalInvested / holdShares`，含已实现盈亏影响，通常不等于持仓成本。不做逐日推进的累计成本趋势线，持仓成本线的既有行为完全不变。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 口径 | 静态水平线，取当前汇总 `totalInvested / holdShares`，全区间固定 | 汇总口径可直接得出，无需逐日重建 |
| 触发条件 | **严格大于**持仓成本才画；相等或更低不画 | 两口径相等多见于从未卖出，避免两条线完全重合 |
| 生效范围 | 趋势通道图（指标分析 / 信号两个弹窗）+ 净值走势卡 | 两图都承担成本对比 |
| 样式 | 与持仓成本同色系，改用点线区分，标签「累计成本 x.xxxx」 | 不新增配色，靠线型区分两条成本线 |
| 标签位置 | 趋势通道图两条标签分别 `insideEndTop` / `insideEndBottom` | 数值接近时避免叠字 |
| 图例与 tooltip | 不进入图例、不参与 tooltip | 与既有成本线保持一致 |
| 成本计算入口 | `channelModal` 收敛为单一 `costInfo` 方法统一返回两条成本 | 原先 `renderSignal` / `renderChannel` 各算一遍，易分叉 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/charts/trendChannel.ts` | `buildChannelOption` 新增 `cumulativeCost` 参数；`markLine` 由单条改为多行 `data`，条件成立时追加点线条目 |
| `src/ui/charts/navChart.ts` | `buildNavOption` 在 `avgCostPerShare > 0` 且累计成本更大时向 `markLineData` 追加累计成本线 |
| `src/ui/channelModal.ts` | 新增 `costInfo` 统一成本口径，`renderChannel` 补传累计成本 |
| `src/ui/signalModal.ts` | `renderChannel` 由 `d.summary` 计算累计成本并补传（`summary` 为 `null`、`holdShares <= 0` 兜底为 `null`） |

## 4. 关键修正与教训

- **从未卖出过的基金两口径完全相等** → 判定必须是严格大于，否则会出现两条重合线。
- **两条线数值接近时标签叠字** → 标签位置上下错开（`insideEndTop` / `insideEndBottom`）。
- **`markLine` 从单条对象改为多行 `data`** → 只画持仓成本时的样式、图例与 tooltip 必须逐项保持不变，这是主要回归点。
- **同一弹窗两处各自计算成本** → 抽 `costInfo` 统一口径，后续新增成本类型只改一处。

## 5. 已知边界

- 无持仓、`holdShares <= 0` 或成本缺失时两条线都不画，且不报错。
- 累计成本为静态值：切换近 6 月 / 近 1 年 / 近 3 年 / 全部时保持全区间数值，不随区间缩放。
- 不影响原有「持仓成本」阶梯趋势线与买卖标记。

## 6. 后续候选

- 暂无。
