---
date: 2026-09-16
description: 缩小净值走势图与趋势通道图的买入/卖出标记点尺寸，避免密集时遮挡曲线
status: accepted
---

# 买卖标记点尺寸缩小 — 决策记录

> 状态：✅ 已验收（2026-09-16）

## 1. 目标与范围
缩小基金净值走势图与趋势通道图的买卖标记点，使其仍可辨识信号但不再遮挡曲线。只改尺寸，不新增同日多笔合并、不做按密度自动缩放；K 线图的买卖标记点保持不动。

## 2. 关键决策
| 决策点 | 结论 | 理由 |
|------|------|------|
| 调整范围 | 仅净值走势图与趋势通道图 | 两者原为 8/14 与 10px，密集时大面积覆盖曲线；K 线图未反馈遮挡 |
| 目标尺寸 | 净值图实心 5px、光晕 8px；通道图 10px → 5px | 显著缩小且仍可辨识 |
| 内圈描边 | 1.5 → 1 | 5px 直径下 1.5px 白描边会吃满实心区域，视觉上变空心 |
| 密集重叠处理 | 只改尺寸 | 合并/自适应缩放的复杂度与收益不成比例 |

## 3. 交付物
| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/charts/navChart.ts` | `buildNavOption` 内 `pushScatter` 的 `symbolSize` 与内实心圈 `borderWidth` |
| `src/ui/charts/trendChannel.ts` | `pushScatter` 的 `symbolSize` |

## 4. 关键修正与教训
- **通道图 scatter 的 series `id`/`name`、`z`、`borderColor` 与 data 字段被 tooltip 依赖** → 只改尺寸，其余一律不动，否则「买入/卖出金额」「点位净值」展示会失效。
- **光晕圈仍须 `silent: true` 且层级高于净值线与成本线** → 否则 hover 命中与视觉层次都会退化。

## 5. 已知边界
- 标记点变小后 ECharts hover 命中区域同步缩小，极端密集处悬停精度下降（已确认接受，不额外补偿）。
- `navChart.ts` 的 `pushScatter` 在 data 项与 series 级双重定义 `itemStyle`，以 series 级生效，写法冗余。

## 6. 后续候选
- 清理 `navChart.ts` 中重复的 `itemStyle` 定义。
