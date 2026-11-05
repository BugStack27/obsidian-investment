---
date: 2026-09-18
description: 记录块的 fence 行属性（skipTradeNotify 等）、源码补全，以及无法解析交易行的行号提示
status: accepted
---

# 记录块属性与解析提示 — 决策记录

> 状态：✅ 已验收（2026-10-24）

## 1. 目标与范围

给记录块增加两项能力：① `fund-record` 的 fence 行支持空格分隔属性（目前仅 `skipTradeNotify`，用于关闭该基金的买卖点提醒），并在源码模式提供属性补全；② 解析记录块时收集无法解析的疑似交易行（块内行号 + 失败原因），在基金 / 股票记录块顶部给出一行只读提示。属性能力仅覆盖 `fund-record`；解析提示覆盖基金与股票两侧。不改变任何「哪行算合法」的判定，`entries` 产出必须与改动前逐行一致。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 属性语法 | fence 行语言标识后空格分隔、大小写不敏感、一行可写多个 | 符合 Markdown info string 习惯 |
| 未知属性 | 渲染区给出警告并列出可用属性，不阻断渲染 | 写错不应影响统计、图表与记录表 |
| `skipTradeNotify` 范围 | 抑制状态栏铃铛计数、信号弹窗列表、侧栏卡片角标三处提醒；图表买卖标记与通道信号计算保留 | 关闭的是「提醒」，不是「信号计算」 |
| 补全形态 | 源码模式 `EditorSuggest`：fence 行尾触发、前缀过滤、排除已存在属性 | 用户选择自动补全，不做渲染区常驻提示 |
| fence 识别 | 由精确等值匹配改为 `isRecordFence` 正则匹配，作为前置必做改造 | 带属性后原匹配全部失配，渲染、定位与写回会静默失败 |
| 属性读取 | 只从 fence 行读取（处理器 `source` 只含块内内容）；写回只替换块内行 | 避免改写用户配置 |
| 默认模板 | 插入代码块命令与新建基金笔记模板不带任何属性 | 默认保持全量提醒 |
| 无法解析行的行号口径 | 块内相对行号（1 基，fence 行不计） | 与 `entries.lineIdx` 同基准，用户数源码块内行即可对上 |
| 疑似坏行判定 | 首列为类型词，或列数 ≥ 3 且有一列像日期 | 避免把说明文字、标题误报成坏行 |
| 提示详细程度 | 列行号 + 失败原因，超过 10 条折叠为「等 N 行」；纯文字，不支持点击跳转 | 全列会撑高块顶部，编辑器定位 API 成本不划算 |
| 文案归属 | 基金块与股票块共用同一渲染函数 | 两份文案迟早漂移 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/utils/blockAttrs.ts` | `FUND_RECORD_ATTRS` 注册表、`isRecordFence`、`parseFenceAttrs`、`hasAttr`、fence 行反查 |
| `src/utils/recordParser.ts` | `getFirstRecordBlock` 返回块内内容 + 属性；`listRecordBlocks`；`looksLikeRecord`、`classifyFailure`、`isKnownType`；`parseRecordSource` 收集 `unparsed` |
| `src/utils/recordMutation.ts` | `findBlockRange` 改用 `isRecordFence`，保证带属性块可写回 |
| `src/utils/recordBlockLocate.ts` | `locateBlockAttrs`：行号锚点 + 块内内容双重验证，多块不串属性 |
| `src/types.ts` | `RecordLineError`、`UnparsedRecordLine`；`RecordParse` 新增 `unparsed` |
| `src/ui/recordAttrSuggest.ts` | `RecordAttrSuggest extends EditorSuggest`：触发、过滤、候选渲染与插入 |
| `src/ui/recordHint.ts` | `formatUnparsedHint`、`renderUnparsedHint`，复用 `inv-hint inv-attr-warn` |
| `src/ui/recordBlock.ts` / `src/ui/stockRecordBlock.ts` | 渲染属性提示与无法解析行提示 |
| `src/services/fundAnalysis.ts` / `portfolioOverview.ts` / `investmentStore.ts` | 透传 `skipTradeNotify` 并在信号列表过滤 |
| `src/main.ts` / `styles.css` / `README.md` | 注册补全、样式、属性与提示文档 |

## 4. 关键修正与教训

- **fence 行原来按精确等值匹配** → 加上属性后记录块不渲染、加减仓写回静默失败；fence 识别改造必须先行。
- **多块笔记属性串块** → `getSectionInfo` 的 `lineStart` 指向标题行时行号窗口失配，会回退到全文件第一个块；改为「行号 + 块内内容」双重验证。
- **处理器拿不到 fence 行** → 属性只能经 `getSectionInfo` 的整段文本反查。
- **`EditorSuggest` 的 `end` 取当前 token 末尾** → 光标停在词中间时也能整词替换，避免重复属性。
- **补全需尾随空格才弹候选** → 裸写 fence 行时候选为空、不弹面板。
- **`parseRecordLine` 返回 null 有两种含义** → 空行 / 注释与解析失败必须区分，只有后者进 `unparsed`。
- **行号基准必须保持块内 0 基** → 与 `entries.lineIdx` 一致，只在渲染文案时 `+1`；解析层提前 `+1` 会导致后续编辑 / 删除错位。
- **类型白名单曾出现两份真相** → 统一走 `isKnownType`。
- **提示不能放在表格的空状态分支里** → 该分支提前返回，全部行都是坏行时提示会丢失。
- **`unparsed` 为空时不得创建任何 DOM** → 否则合法笔记的块高度也会变化。

## 5. 已知边界

- 属性仅支持 `fund-record`，`stock-record` 不解析属性。
- `skipTradeNotify` 只关提醒，不关信号计算：净值走势图与趋势通道图的买卖标记、指标分析弹窗信号仍在展示。
- 同一笔记多个块且块内内容完全相同、锚点又失效时，只能按距离择近，可能取到同内容块的属性（属未定义用法）。
- 补全仅源码模式生效，阅读模式看不到候选。
- 启发式判定有误报：三列且含日期样串的说明行会被报为「类型无法识别」，只增噪音不影响计算。
- 覆盖缺口：类型拼错且列数 < 3 的行仍静默；首列含空格的写法不报。
- 数据中枢、近期交易、总览卡片不提示坏行。

## 6. 后续候选

- 渲染区常驻「可用属性」提示，覆盖以阅读模式为主的用户。
- 若需连图表买卖标记一并关闭，需另立需求。
- 点击行号跳转源码并定位光标（本次已否决）。
