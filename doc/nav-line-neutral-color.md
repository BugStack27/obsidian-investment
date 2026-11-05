---
date: 2026-09-16
description: 净值曲线由红色主色改为中性石板灰；买卖实心标记点去掉白色描边
status: accepted
---

# 净值线改中性色与买卖点去白描边 — 决策记录

> 状态：✅ 已验收（2026-09-16）

## 1. 目标与范围

净值曲线原用红色主色 `CHART_COLORS.primary`（`#C53D43`），与买入点红色 `CHART_COLORS.profit` 色相几乎一致，买卖点密集处无法区分曲线与买入点；买卖实心点在缩至 5px 后白色描边占比过大，削弱实心色块辨识度。本次仅调整净值走势图与趋势通道图的线色与标记点描边。不改收益图、定投对比弹窗，不改坐标轴、图例与数据口径。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 改哪些图 | 只改 `navChart.ts` 与 `trendChannel.ts` | 仅这两张图同时叠加净值曲线与买卖标记点 |
| `profitChart.ts` / `dcaCompareModal.ts` | 红色主色线保持不动 | 无买卖点，无颜色冲突 |
| 净值线颜色 | 新增 `CHART_COLORS.navLine = '#475569'`（中性石板灰） | 不与买入红/卖出绿抢色，也不与成本线蓝混淆 |
| 面积渐变 | 由 `#475569` 派生 `rgba(71, 85, 105, 0.15)` → 全透明，并注明派生关系 | 线色与填充必须同步，否则残留红色 |
| 白描边 | 实心标记点 `itemStyle` 去掉 `borderColor` / `borderWidth` | 白边在 5px 尺寸下占比过大 |
| 光晕圈 | 净值走势图外层半透明光晕（8px、`opacity: 0.15`）保留 | 与描边无关，属另一视觉层 |
| 色值管理 | 颜色常量统一收敛到 `src/ui/charts/theme.ts`，不散落硬编码 | 避免同类改色出现多份事实 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/charts/theme.ts` | `CHART_COLORS` 新增 `navLine: '#475569'` 并附用途注释；`primary` 保留 |
| `src/ui/charts/navChart.ts` | `buildNavOption` 净值 series `lineStyle.color` 改 `navLine`、`areaStyle` 渐变改灰；`pushScatter` 内圈 `itemStyle` 去掉白描边 |
| `src/ui/charts/trendChannel.ts` | `id: 'nav'` series 线色改 `navLine`；`pushScatter` `itemStyle` 精简为 `{ color }` |

## 4. 关键修正与教训

- **面积渐变最易漏改** → 线色与渐变必须同时由 `navLine` 派生，否则图上仍出现红色 rgba（`197, 61, 67`）。
- **去描边只动 `itemStyle`** → `symbolSize`（内 5 / 外 8）、`z`、`silent`、data 项 `itemStyle.color` 均保持不变，标记点数量与位置不得变化。
- **趋势通道图散点的 data 字段是 tooltip 契约** → `_date` / `_nav` / `_amount` / `_type`、series `id`（`tx-buy` / `tx-sell`）与 `name`（买入/卖出）必须保留，否则交易金额 tooltip 断裂。
- **通道图其余元素不可顺手改** → 均线 `secondary` 蓝、通道填充（由 `secondary` 派生）、上下轨 `textTertiary`、末点估值灰虚线保持原样。

## 5. 已知边界

- 仅改两条曲线，红色主色在收益图与定投对比弹窗中继续使用，界面并非全局去红。
- `navChart.ts` 的静态持仓成本 `markLine` 仍为红色 `CHART_COLORS.profit` 虚线，与买入点同色，本次刻意不处理。

## 6. 后续候选

- 将静态持仓成本 `markLine` 改为蓝色系，彻底消除红色歧义。
