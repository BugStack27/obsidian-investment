---
date: 2026-11-10
description: 股票记录块补「导出全部记录」，复用基金侧 CSV 导出工具并按股票代码出列，方便备份与核对券商流水
status: accepted
---

# 股票记录块导出全部记录 — 决策记录

> 状态：✅ 已验收（2026-11-10）

## 1. 目标与范围

基金 `fund-record` 块右上角有「导出全部记录」，股票 `stock-record` 块只有加仓 / 减仓 / 分红，流水无法一键留存。本次在股票记录块补同款导出按钮，下载当前块内全部已解析交易记录的 CSV。不改表格列、写入链路与导入能力（股票侧仍无批量导入）。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 复用导出工具 | 沿用 `transactionsToCsv` / `downloadCsv` | 与基金侧同一序列化、转义与下载实现，行为不分叉 |
| 代码列 | 传入股票代码，表头为 `stockCode` | 导出后仍需知道属于哪只股票；沿用 `fundCode` 名会误导核对与后续脚本 |
| 接口扩展 | `transactionsToCsv(txs, code?, codeHeader = 'fundCode')` | 默认值保证基金调用点零改动 |
| 导出数据源 | `props.parsed.entries` 的已解析交易 | 与表格、持仓统计同源；未解析行仍由块顶提示手工处理 |
| 文件名 | `<code>-records.csv` | 与基金侧命名一致，便于同一套归档习惯 |
| 按钮位置 | 加仓 / 减仓 / 分红之后 | 与基金侧「导出在导入之后」的相对位置一致 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/ui/stockRecordBlock.ts` | `addActionButtons` 增加导出按钮，复用它生成 CSV 并下载 |
| `src/utils/importExport.ts` | `transactionsToCsv` 增加可配置代码列表头，默认仍为 `fundCode` |
| `README.md` | 股票记录块段落补充导出按钮与 CSV 含股票代码的说明 |

## 4. 验证

- `npm run build`（tsc 类型检查 + esbuild 打包）通过。
- 导出的 CSV 表头为 `stockCode,type,date,amount,shares,fee,note`，金额与数量为零的字段留空，字段含逗号时按 CSV 规则加引号。

## 5. 已知边界

- 股票侧没有批量导入，导出的 `stockCode` 列目前只用于留存与对账，不回读。
- 记录只存金额与数量，CSV 不含派生价格列；需要价格时按「金额 ÷ 数量」换算。
