---
date: 2026-09-18
description: fund-record 代码块支持 fence 行属性（skipTradeNotify 关闭买卖点提醒），并新增源码模式属性自动补全
status: accepted
---

# fund-record 代码块属性 — 决策记录

> 状态：✅ 已验收（2026-09-18）

## 1. 目标与范围

让单个基金可做行为配置：在 `fund-record` 的 fence 行语言标识后追加空格分隔的属性，目前仅 `skipTradeNotify`（关闭该基金的买卖点提醒）；同时在源码模式提供属性自动补全，解决「不知道能写什么」的问题。仅 `fund-record`，`stock-record` 不接入属性渲染与补全（解析器写成可复用形式）。

## 2. 关键决策

| 决策点 | 结论 | 理由 |
|------|------|------|
| 属性语法 | fence 行空格分隔、大小写不敏感、一行可写多个 | 符合 Markdown info string 习惯 |
| 未知属性 | 渲染区给出警告并列出可用属性，不阻断渲染 | 写错不应影响统计、图表与记录表 |
| 提醒范围 | 状态栏铃铛计数、信号弹窗列表、侧栏卡片角标三处全部抑制；图表买卖标记与通道分析信号保留 | 关闭的是「提醒」，不是「信号计算」 |
| 输入提示形态 | 源码模式 `EditorSuggest`：fence 行尾触发、前缀过滤、排除已存在属性；不做渲染区常驻提示 | 用户选择自动补全形态 |
| fence 识别 | 由精确等值匹配改为 `isRecordFence` 正则匹配，作为前置必做改造 | 带属性后原匹配全部失配，记录块渲染、定位与写回会静默失败 |
| 属性读取 | 属性只从 fence 行读取（处理器 `source` 只含块内内容）；写回只替换块内行，属性天然保留 | 避免改写用户配置 |
| 模板 | 插入代码块命令与新建基金笔记模板不带任何属性 | 默认保持全量提醒 |
| 文档 | README 补充属性语法、`skipTradeNotify` 作用范围与补全用法 | 属性是隐藏能力，需可发现 |

## 3. 交付物

| 文件（相对路径） | 职责 |
|------|------|
| `src/utils/blockAttrs.ts` | `FUND_RECORD_ATTRS` 注册表、`isRecordFence`、`parseFenceAttrs`、`hasAttr`、fence 行反查 |
| `src/utils/recordParser.ts` | `getFirstRecordBlock`（返回块内内容 + 属性）、`listRecordBlocks`；`getFirstRecordInner` 保持签名并委托 |
| `src/utils/recordMutation.ts` | `findBlockRange` 改用 `isRecordFence`，保证带属性块可写回 |
| `src/utils/recordBlockLocate.ts` | `locateBlockAttrs`：行号锚点 + 块内内容双重验证，多块不串属性 |
| `src/ui/recordBlock.ts` | 读取属性并渲染「已关闭提醒」/「无法识别属性」提示；`BlockProps` 增加 `attrs` |
| `src/ui/recordAttrSuggest.ts` | `RecordAttrSuggest extends EditorSuggest`：触发、过滤、候选渲染与插入 |
| `src/services/fundAnalysis.ts` | `FundAnalysisData` 增加 `skipTradeNotify`，由属性解析赋值 |
| `src/services/portfolioOverview.ts` | `FundCard` 透传 `skipTradeNotify`；`signal` 计算不动 |
| `src/data/investmentStore.ts` | `toSignalItems` 过滤 `signal && !skipTradeNotify` |
| `src/ui/fundView.ts` | 卡片信号角标条件同步排除 |
| `src/main.ts` | 注册 `RecordAttrSuggest`（随插件卸载自动清理） |
| `styles.css` | 属性提示与候选面板样式 |
| `README.md` | 记录块属性说明与示例 |

## 4. 关键修正与教训

- **fence 行原来按精确等值匹配** → 加上属性后记录块不渲染、一键加减仓写回静默失败；fence 识别改造必须先行。
- **多块笔记属性串块**：`getSectionInfo` 的 `lineStart` 指向标题行时，行号窗口失配后回退到「全文件第一个块」，后面的块继承第一个块的属性 → 改为「行号 + 块内内容」双重验证，并抽到 `recordBlockLocate`。
- **处理器拿不到 fence 行** → 属性只能经 `getSectionInfo` 的整段文本反查，不能用 `source`。
- **`EditorSuggest` 的 `end` 取当前 token 末尾** → 光标停在词中间时也能整词替换，避免补全后出现重复属性。
- **补全需尾随空格才弹候选** → 裸写 fence 行时候选为空、不弹面板。

## 5. 已知边界

- 仅 `fund-record`；`stock-record` 不解析属性。
- `skipTradeNotify` 只关提醒，不关信号计算：净值走势图与趋势通道图的买卖标记、指标分析弹窗信号仍在展示。
- 同一笔记多个块且块内内容完全相同、锚点又失效时，只能按距离择近，可能取到同内容块的属性（属插件未定义用法，数据链路本就只认首个块）。
- 补全仅源码模式生效，阅读模式看不到候选。

## 6. 后续候选

- 渲染区常驻「可用属性」提示，覆盖以阅读模式为主的用户。
- 若需连图表买卖标记一并关闭，需另立需求。
