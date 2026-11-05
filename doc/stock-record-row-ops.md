---
date: 2026-10-24
description: 股票笔记交易记录表每行补上编辑 / 删除图标按钮，复用统一记录弹窗与确认弹窗，编辑时按「价格 = 金额 ÷ 数量」回显
status: accepted
---

# 股票记录表行内编辑与删除 — 决策记录

> 状态：✅ 已验收（2026-10-24）

## 1. 目标与范围
为股票笔记 `stock-record` 表格每行补「编辑 / 删除」图标，行为与基金 `fund-record` 表格对齐：编辑复用统一弹窗 `PositionTradeModal`（锁定标的与类型），删除复用 `ConfirmModal` 先确认。不改动基金侧代码、不改 CSS、不新增依赖，也不提供批量操作。

## 2. 关键决策
| 决策点 | 结论 | 理由 |
|------|------|------|
| 编辑回显价格精度 | 固定 2 位小数 | 行内只存金额与数量，价格是派生量；A 股报价即 2 位，常态往返编辑无损 |
| 分红行是否可编辑 | 只显示删除按钮 | 分红行无数量与价格，算不出回显价格，弹窗必被拦住 |
| 编辑是否锁定买卖方向 | 锁定（`typeLocked`） | 与基金编辑入口一致；记错方向需删掉重录 |
| 操作列结构与样式 | 表头补空字符串，单元格用 `inv-ops` 类 | `styles.css` 已全局定义 `.inv-ops`，本次零 CSS 改动 |
| 写回定位 | 排序时保留原始块内 `lineIdx` | 写回按块内行号定位，不能用排序后下标 |

## 3. 交付物
| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/stockRecordBlock.ts` | `StockBlockProps.onMutate` 返回 Promise；`renderStockTable` 补操作列与行号映射；`stockTarget`、`openEditModal`、`confirmDeleteRecord` 承担编辑/删除 |

## 4. 关键修正与教训
- **股票目标下弹窗只渲染「数量 + 价格」** → 必须传 `price` 而非 `amount`，否则价格回显为 0 并被行情价异步预填覆盖（`priceTouched` 仅在 `price > 0` 时成立）。
- **写回时行号越界** → `replaceRecordAtLine` / `removeRecordAtLine` 返回 null 时抛错，不静默原样写回。
- **`onMutate` 原先不返回 Promise** → 改为返回 `Promise<void>`；加仓/减仓、编辑、删除三个调用点都必须处理 rejection。

## 5. 已知边界
- `type=buy` 但 `shares=0` 的畸形行仍显示编辑按钮（刻意保留补填修复路径），但回显价格为 0 会被行情价覆盖。
- 金额与价格字段不匹配是结构性取舍：若原始金额不等于「数量 × 两位小数价格」（如手填时把手续费并入金额），保存后金额有分位级偏差。
- `transformRecordBlock` 只定位笔记内首个 `stock-record` 块，多块笔记会写错块（基金侧同样存在，未扩大修复范围）；弹窗停留期间文件被外部改动时，越界行号可拦、指向他行不可识别。
- `stockRecordBlock.ts` 改动后约 378 行，超出单文件 200-300 行的软建议，未拆分。

## 6. 后续候选
- 给记录行增加价格列（CSV 第 7 列），让编辑后金额绝对无损。
- 文件继续增长时抽出 `stockRecordTable.ts`。
