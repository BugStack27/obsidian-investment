---
date: 2026-11-07
description: 图表跟随容器尺寸自动重排：echarts 初始化统一挂 ResizeObserver，笔记缩放、分栏拖动后曲线不再停在原位
status: accepted
---

# 图表跟随容器自动缩放 — 决策记录

> 状态：待验收（2026-11-07）

## 1. 目标与范围

修复基金笔记详情中净值走势、收益走势图在 Obsidian 缩放（Ctrl + 滚轮 / 缩放命令）或分栏宽度变化后仍保持初始化尺寸的问题。范围限定为尺寸跟随，不改动图表数据、区间切换与主题。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 落点 | 统一改在 `src/ui/charts/echartsInit.ts` 的 `initChart` / `disposeChart` | 所有图表（笔记内基金净值/收益、股票 K 线、各弹窗）都走这一层，一次修复覆盖全部入口 |
| 监听方式 | 每个图表对自身容器挂 `ResizeObserver` | 容器宽高变化直接触发，能覆盖 Obsidian 缩放（浏览器缩放级，视口 CSS 像素随之变化）、分栏拖动、窗口缩放、侧栏开合 |
| 重排节流 | 观察回调内用元素所在窗口的 `requestAnimationFrame` 合并，每帧最多 `resize()` 一次 | 拖动分栏时会连续触发，避免每像素重绘；弹窗（popout）窗口各自用自己的帧调度 |
| 无效重排 | 容器宽或高为 0 时跳过；宽高与 `chart.getWidth()/getHeight()` 相同则跳过 | 折叠/隐藏状态下不产生告警，尺寸未变不做无谓重绘 |
| 像素比 | 初始化时显式传入当前 `devicePixelRatio` | zrender 默认 DPR 在模块加载时固化，Obsidian 缩放后新建的图表仍会按旧 DPR 绘制 |
| 生命周期 | `disposeChart` / `disposeAllCharts` 先 `disconnect()` 观察器再销毁实例 | 记录块重渲染、弹窗关闭后不留观察器与实例 |

## 3. 验证

- `npm run build`、`npm run lint` 通过（无新增告警）。
- 用 esbuild 单独打包 `echartsInit.ts`，在无头 Chromium 中实测：容器 400px → 250px 时 `chart.getWidth()` 与画布同步为 250；容器隐藏再显示并改为 520px 后同步为 520；`disposeChart` 后容器内画布数量归 0。
- 未在 Obsidian 应用内实机验证缩放（浏览器级缩放会改变 DPR，见已知限制）。

## 4. 已知限制

- 已在页面中的图表遇到 `devicePixelRatio` 变化（缩放时）不会重建，画布跟随重排填满容器但可能比周围文字略糊；重建会替换实例、打断调用方持有的图表引用，故不通过修改 zrender 内部或透明重建解决。
