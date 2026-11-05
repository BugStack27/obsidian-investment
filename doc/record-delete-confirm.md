---
date: 2026-10-21
description: 基金笔记交易记录删除按钮在写回文件前先弹确认弹窗，并补成功提示，避免误触抹掉买卖流水
status: accepted
---

# 交易记录删除前确认 — 决策记录

> 状态：✅ 已验收（2026-10-21）

## 1. 目标与范围

`fund-record` 块买卖记录表的删除按钮与编辑按钮紧邻且仅靠图标区分，点击后直接经 `onMutate` → `transformRecordBlock` → `vault.process` 原地改写笔记，既无确认、也无撤销与成功提示，误触会让持仓份额、累计投入与收益率一起失真。本次为删除加一次确认弹窗与成功 Notice。仅覆盖基金 `fund-record` 的删除按钮；股票 `stock-record` 无删除按钮，持仓编辑弹窗的「删除」只改内存 `rows` 需另点保存，均不在范围。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 弹窗形式 | 自建 `ConfirmModal extends Modal`，用 `Setting` 摆「取消 / 确认删除」 | Obsidian 无内置 confirm；`window.confirm` 样式不可控，`SuggestModal` 回车即删与「先确认」相悖 |
| 正文内容 | 写明记录类型（买入/卖出/分红）、日期、金额 | 用户需确认删的是哪一条；类型映射沿用表格 `typeBadge` |
| 金额口径 | `tx.amount > 0 ? fmtMoney(...) : '—'` | 与表格列展示逐字一致 |
| 危险态样式 | `danger` 时 `setWarning()`，不叠加 `setCta()` | `mod-cta` 与 `mod-warning` 同时存在会样式冲突 |
| 正文层级 | 首行引导问句用 `inv-hint` 弱化，类型/日期/金额用正文样式 | 决策关键信息不应是灰色小字 |
| 成功提示 | 写回完成后 `Notice('已删除 <类型> 记录（<日期>，<金额>）')` | 让用户明确知道账本已变化 |
| 写回失败 | 沿用既有「写回记录失败」提示，成功提示不发出 | 不能谎报删除成功 |
| 取消/关闭 | 仅 `close()`，绝不触发回调 | 唯一写回入口在 `onConfirm` |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/confirmModal.ts`（新建） | `ConfirmModal`（`title` / `message` / `confirmText` / `cancelText` / `danger` + `onConfirm`）；`message` 按 `\n` 拆行渲染；`onClose` 清空内容区 |
| `src/ui/recordBlock.ts` | `renderTable` 删除回调改为先弹 `ConfirmModal`，确认后才 `removeRecordAtLine` 写回；`BlockProps.onMutate` 签名由 `() => void` 改为 `() => Promise<void>`；删除成功后链式发 Notice；其余 `onMutate` 调用点补 `.catch()` |

## 4. 关键修正与教训

- **行号越界时 `removeRecordAtLine(...) ?? inner` 会原样写回却仍提示「已删除」** → 越界改为 `throw`，走既有「写回记录失败」提示。
- **`onMutate` 内部吞掉异常导致成功提示误报** → 改为提示后 `throw`，成功 Notice 只挂在 Promise 成功分支。
- **`onMutate` 改为返回 Promise 后产生未处理的 rejection** → 批量导入、加减仓/分红、编辑等调用点统一 `.catch(() => undefined)`。
- **正文全用弱化小字** → 首行问句弱化、关键信息正文，确认按钮危险态用 `setWarning()` 而非 `setCta()`。

## 5. 已知边界

- 笔记含多个 `fund-record` 块时 `findBlockRange` 只定位第一个块，可能写错块（既有风险，未修）。
- 弹窗停留期间文件被外部改动会导致行号失效：越界已能报错，但非越界的错删仍可能发生。
- 不提供撤销机制，确认弹窗是刻意的摩擦成本。
- 批量导入的「已导入 N 条」提示时机与删除路径口径不一致（既有差异）。

## 6. 后续候选

- `ConfirmModal` 复用到持仓编辑弹窗的删行与股票记录块删除。
- 修复多 `fund-record` 块的定位问题。
