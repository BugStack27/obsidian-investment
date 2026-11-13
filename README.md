# Investment Tracker

An Obsidian plugin that records fund and A-share trades directly inside your notes as `fund-record` / `stock-record` code blocks, renders each block as an editable table, computes holdings and profit, and shows net-value / K-line charts plus buy-sell signal hints in a sidebar view. Quotes and NAV history come from [stock-sdk](https://stock-sdk.linkdiary.cn) (public East Money / Sina endpoints).

[中文说明](#中文说明) · [Releases](https://github.com/BugStack27/obsidian-investment/releases)

## Features

- **Trades live in your notes** — one CSV line per transaction inside a `fund-record` / `stock-record` code block. The block is rendered as a table with edit / delete icons per row, and the add / reduce / dividend buttons and the batch-import dialog write back into that same block. No hidden database, no external account.
- **Holdings and profit** — market value, invested amount, dividends, total profit and return rate, today's profit, average cost, shares held, holding days, trailing 12-month return, and more. Fees are folded into cost and cash flow; XIRR is used for annualised returns.
- **Charts** — NAV trend chart with cost line and trade markers, yearly profit chart, "manual trades vs weekly DCA" comparison chart, and daily / weekly / monthly K-line charts for stocks with actual buy-sell points marked.
- **Sidebar overview** — sidebar cards for every fund and stock, and a status bar showing total assets, cumulative profit, annualised return and today's profit.
- **Intraday estimate and signals** — during the trading session the plugin pulls real-time estimates every 60 seconds, and after 13:00 it flags buy / sell signals based on the trend channel and your cost line; each signal can be confirmed or ignored, and that state only lasts for the day.
- **Batch import / export** — paste CSV or pick a `.csv` file; Chinese and English headers are both recognised, key fields are extracted, duplicates and other funds' rows are skipped, and all records can be downloaded as CSV.

## Installation

Install through [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. In **Settings → Community plugins**, turn off restricted mode, then install and enable **BRAT**.
2. Open the **BRAT** settings and choose **Add beta plugin**.
3. Enter the repository: `BugStack27/obsidian-investment`
4. Confirm, wait for BRAT to fetch the latest release, then enable **Investment Tracker** in **Settings → Community plugins**.

Manual install: download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/BugStack27/obsidian-investment/releases), put them in `<vault>/.obsidian/plugins/investment-tracker/`, restart Obsidian and enable the plugin.

> Upgrading from a build that used the previous plugin ID: rename `<vault>/.obsidian/plugins/obsidian-investment/` to `investment-tracker`; the plugin's `data.json` moves with the folder.

> BRAT installs a published release. If the release is still a draft, publish it first.

## Usage

1. Add a fund note or a stock note: right-click a folder in the file explorer → **添加基金** / **添加股票**, search by code or name, and the plugin creates a note whose frontmatter carries `fund_code` / `stock_code`, the `fund-investment` / `stock-investment` tag, and an empty record block. Writing the frontmatter by hand works too.
2. Record transactions as one CSV line per trade, or use the **加仓 / 减仓 / 分红** buttons, the **加减仓** command and the **导入** dialog instead of typing CSV.
3. Open the note to read the rendered table, the summary and the chart; open the sidebar for the whole portfolio.

Fund records use `type,date,amount[,shares][,fee][,note]`; stock records use `type,date,amount,quantity[,fee][,note]`. When an amount or a share count is missing, the plugin fills it in from the NAV of the trade date; a record whose NAV is still unavailable is left out of holdings and profit until it can be completed, so it never enters the books at zero cost.

## Commands

| Command (as shown in Obsidian) | What it does |
| --- | --- |
| 打开基金汇总侧栏 | Open the portfolio sidebar (fund and stock cards; also on the ribbon) |
| 打开指标分析 | Trend-channel and indicator analysis for the current fund |
| 在当前笔记插入 fund-record 买卖代码块 | Insert an empty `fund-record` block with a commented template |
| 查看近期操作 | List buy / sell records for today / 7 / 30 / 90 days (funds and stocks) |
| 加减仓 | Record one add / reduce / dividend transaction against any fund or stock |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| 净值缓存时长 | 6 hours | How long NAV results stay in the in-memory cache (1–24 hours) |
| 基金/股票笔记默认打开模式 | Off | Whether the plugin opens fund / stock notes in source mode (on) or preview mode (off) |

Settings are stored in the plugin's `data.json` and are searchable in Obsidian's settings search (Obsidian 1.13.0 and later).

## Privacy and data access

- **Not fully offline.** NAV history, quotes and K-line data are fetched from third-party financial APIs (East Money `datacenter-web.eastmoney.com`, Sina `hq.sinajs.cn`, plus the endpoints used by the bundled [stock-sdk](https://stock-sdk.linkdiary.cn) client) through Obsidian's `requestUrl`.
- **What leaves your device** — only the security codes being looked up: the fund / stock code of the notes being summarised, the comma-joined list of fund codes queried for intraday estimates, and the keyword you type in the **添加基金** / **添加股票** search box.
- **What never leaves** — note bodies, file names, vault paths and account details are not uploaded. There is no telemetry, analytics or crash reporting, and no server run by the author.
- **What is read from the vault** — the frontmatter (`fund_code` / `stock_code`, tags) of fund and stock notes and the lines of their `fund-record` / `stock-record` blocks, used to compute holdings and profit. Other notes and attachments are not read.
- **What is written** — the record blocks you ask the plugin to create or edit, and its own `data.json`. It does not delete or rewrite other note content.
- **Caching** — NAV / quote results live in memory only (see the **净值缓存时长** setting) and are never written to disk.
- **Caveat** — `stock-sdk` loads part of the East Money data by injecting a `<script>` tag to work around CORS, so the plugin depends on third-party scripts served by those hosts. If your Obsidian blocks them through its content security policy, switch the transport in `src/services/stockSdk.ts`.

## Compatibility

- Obsidian `1.7.2` and later.
- Desktop and mobile (`isDesktopOnly: false`); the data layer uses `requestUrl` rather than Node APIs.
- Network access is needed for quotes, NAV history and search. Records stay in your notes and remain readable offline; charts and profit fall back to cached or last-known values.
- Settings use the declarative settings API on Obsidian 1.13.0 and later, and fall back to the classic settings tab on older versions.

## Development

```bash
npm install     # install dependencies
npm run dev     # watch mode, writes main.js
npm run build   # type check + production build
npm run lint    # ESLint
```

Source lives in `src/`; the build output is `main.js` (not committed).

For local debugging, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/investment-tracker/` and reload Obsidian.

## Release

```bash
npm version patch   # updates package.json, manifest.json, versions.json and tags the commit
git push --follow-tags
```

Pushing the tag makes GitHub Actions run the type check and build, then create a draft release with `main.js`, `manifest.json`, `styles.css` and build provenance. Review it and publish the release manually.

## License

[0-BSD](LICENSE)

---

## 中文说明

### 快速开始

#### 基金

1. 在目标笔记的 frontmatter 写入 `fund_code`（基金代码），并在 `tags` 中加入 `fund-investment`。
2. 在笔记中插入一个 `fund-record` 代码块（可用命令「在当前笔记插入 fund-record 买卖代码块」）。
3. 代码块里的每一行是一条交易记录，格式为 CSV：`type,date,金额[,份额][,手续费][,备注]`。

```fund-record
# 买入（按金额，份额自动补全）
buy,2026-07-08,1000
# 买入（按份额，金额自动补全）
buy,2026-07-10,,600
# 卖出（按份额，金额自动补全）
sell,2026-07-20,,500
# 可带手续费与备注
buy,2026-08-01,2000,1750,1.5,手动定投
# 分红（现金到账金额）
dividend,2026-07-01,120
```

渲染出的表格右上角有纯图标按钮：**＋ 加仓**、**－ 减仓**、**🎁 分红**（弹窗新增）、**导入**（批量导入 CSV）、**导出**（下载全部记录）。无需手写 CSV。

##### 记录块属性

`fund-record` 后面可以追加属性（空格分隔，大小写不敏感），用于对单个基金做行为配置：

```fund-record skipTradeNotify
buy,2026-07-08,1000
```

| 属性 | 说明 |
|------|------|
| `skipTradeNotify` | 关闭该基金的买卖点提醒：不再计入状态栏铃铛计数、不出现在买卖信号处理弹窗、侧栏卡片不显示信号角标（净值走势图与趋势通道图上的买卖标记、指标分析弹窗中的信号**不受影响**）。 |

- 在源码模式下输入 ` ```fund-record `（尾随空格）会自动弹出可用属性候选，回车即可补全。
- 支持一行写多个属性；写错属性名时记录块顶部会给出告警并列出可用属性。

#### 股票（A 股）

1. 在目标笔记的 frontmatter 写入 `stock_code`（6 位股票代码），并在 `tags` 中加入 `stock-investment`。
2. 在笔记中插入一个 `stock-record` 代码块。
3. 代码块里的每一行是一条交易记录，格式为 CSV：`type,date,金额,数量[,手续费][,备注]`。

```stock-record
# 买入（按成交金额与数量）
buy,2026-07-08,5000,100
# 卖出
sell,2026-07-20,3000,50
```

代码块会渲染成持仓汇总（最新价、持仓数量、持仓成本、持仓市值与盈亏；**有过卖出或分红时额外显示「总收益」**，把已卖出回款与分红一并累计，口径与基金侧一致：总收益 = 持仓市值 − 净投入 + 累计分红，收益率分母为累计买入金额）＋ K 线走势图（日线/周线/月线，可选）＋ 交易记录表格，右上角提供 **加仓 / 减仓 / 分红** 按钮（默认预填最新价）与 **导出全部记录**（下载含股票代码的 CSV，与基金侧口径一致）。K 线上会标记实际买入/卖出点位。

### 功能

#### 基金
- **fund-record 代码块**：把 CSV 流水渲染成表格（含参考净值、待确认状态提示）；每条记录带编辑 / 删除图标；右上角加仓 / 减仓 / 分红按钮弹窗新增。
- **添加基金**：在文件管理器右键文件夹 → 「添加基金」，弹出搜索框（按代码/名称）→ 选中后在该文件夹下创建基金笔记，自动写入 `fund_code`、`fund-investment` 标签和空白的 `fund-record` 代码块。新笔记默认按设置中的打开模式打开。
- **批量导入 / 导出**：右上角导入弹窗支持粘贴 CSV 或选择 `.csv` 文件，自动识别中英文表头（如 日期,方向,金额,份额、type,date,amount,shares）或固定顺序导入，仅提取 `type/date/amount/shares/fee/note` 关键字段，重复记录自动去重、其它基金记录跳过；导出按钮一键下载全部记录（含基金代码）。
- **待净值补全**：买入未填份额或未填金额、卖出未填金额时，按记录当日（或其后最近）净值推导 `份额 = 金额 ÷ 净值`、`金额 = 份额 × 净值`；当日无净值显示「待确认」（待确认记录不计入持仓与收益，避免以 0 成本入账）。分红计入累计收益（总收益 = 持仓市值 − 累计投入 + 累计分红），不影响持有份额与累计投入。手续费按实际资金流处理：买入计入成本，卖出与分红冲减回款，持仓成本、累计收益与年化（XIRR）均已扣除。
- **收益统计与图表**：持仓市值、累计投入、累计分红、总收益 / 收益率、今日盈亏、平均持仓成本、持有份额与天数、近一年收益、距上次买卖等；净值走势图（含持仓成本线与买卖标记）、年度收益图、「手动操作 vs 定投」对比图（实际年化 vs 每周定投年化，XIRR 口径，含收益差曲线）。
- **通道分析**：打开基金笔记时，可在走势图上查看趋势通道（均线 ± 标准差带）与当日买卖信号，并可按基金调整均线类型/天数、标准差类型等参数（按基金持久化），信号判断优先采用当日实时估值。

#### 通用
- **盘中实时估值**：交易时段（9:30–15:00）每 60 秒拉取基金实时估值，卡片、状态栏「今日盈亏」以及信号判断都优先采用估值口径；非交易时段回退官方净值口径。
- **买卖信号**：下午 13:00 之后，结合趋势通道与持仓成本线给出买入/卖出信号（买入 = 最新估值低于持仓成本且低于通道下轨；卖出反之），在侧栏卡片和状态栏铃铛徽标上提示；点开可确认或忽略，状态仅当天有效。
- **状态栏总览**：底部状态栏与侧栏汇总卡显示**总资产、累计收益、年化收益率、今日盈亏**。总资产与累计收益**含股票持仓**（股票市值按记录块买卖推导的持仓数量 × 最新行情计算，累计收益含已卖出回款与分红）；年化与今日盈亏仍只统计基金，卡面会注明该口径，股票行情不可得时不按 0 计入，而是点名「N 只股票无行情，未纳入统计」。年化用全组合基金现金流 XIRR，不可算时回退旧口径：持有满一年复利年化，不满一年直接取总收益率；交易时段每 60s 估值刷新，每小时全量补一次。
- **近期操作**：命令「查看近期操作」弹窗可切换 **今日 / 7 / 30 / 90 天** 四档，列出窗口内已录入的买入 / 卖出记录（基金 + 股票，含金额、份额/数量、参考净值、手续费、备注）。**今日档**额外展示**持有金额（持仓市值）**，并按「买入在前、卖出在后，组内持仓市值降序」排列，用于审视当日调仓权重；其余档按**日期倒序分组**、同日买入在前，用于对照券商 / 平台流水核对哪些操作还没录入。顶部汇总当前窗口的买卖笔数与金额；点击任意一行跳转对应笔记，弹窗右上角可直接「记一笔买卖」补录，保存后列表即时刷新。分红不计入。
- **加减仓**：命令「加减仓」打开统一记录弹窗，可**跨标的**直接记一笔：从库内全部基金 / 股票笔记中选择标的（支持关键词过滤）、选日期、选加仓 / 减仓（基金另含分红）。笔记内的加仓 / 减仓 / 分红按钮、表格行编辑、买卖信号确认都收敛到这个弹窗（场景内目标自动锁定，防止写错笔记）；保存后记录写入对应笔记的买卖代码块。基金买入只填**金额**，份额按记录日净值自动计算，输入金额时以下方提示预估确认份额；基金卖出只填**份额**，到账金额按当日估值（无当日估值时回退最新净值）实时预估。只填份额的历史买入记录也能按净值补出金额，拿到正确成本与收益。
- 数据完全存在笔记本地，净值/估值仅用于计算，不会写回你的记录。记录里的手续费会计入基金与股票的持仓成本、累计收益与年化现金流（买入计入成本，卖出与分红冲减回款）。

### 命令

| 命令 | 说明 |
| --- | --- |
| 打开基金汇总侧栏 | 打开左侧侧栏的汇总视图（基金 + 股票卡片，ribbon 上也有图表图标） |
| 打开指标分析 | 当前基金的趋势通道与指标分析弹窗 |
| 在当前笔记插入 fund-record 买卖代码块 | 插入一个带注释的空模板 |
| 查看近期操作 | 弹窗按今日 / 7 / 30 / 90 天窗口列出买入 / 卖出记录（基金 + 股票），今日档额外展示持有金额 |
| 加减仓 | 弹窗记录一笔加仓 / 减仓 / 分红：可选基金或股票、日期与类型，写回对应笔记 |

文件管理器右键文件夹时还提供「添加基金」「添加股票」菜单（分别创建基金 / 股票笔记）。

### 设置
- **净值缓存时长**：stock-sdk 净值结果的内存缓存小时数（默认 6h）。
- **基金/股票笔记默认打开模式**：通过插件进入基金 / 股票笔记时用**编辑模式**还是**阅读模式**（默认：关闭 = 阅读/预览模式，开启 = 编辑/源码模式；手动切换不受影响）。

设置保存在插件的 `data.json` 中；Obsidian 1.13.0 及以上版本会把它们编入设置搜索。

### 安装

本插件通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装。

1. 在 **设置 → 第三方插件** 中关闭受限模式，安装并启用 **BRAT**。
2. 打开 **BRAT** 设置，选择 **Add beta plugin**。
3. 填入仓库地址：`BugStack27/obsidian-investment`
4. 确认并等待 BRAT 拉取最新 Release，然后在 **设置 → 第三方插件** 中启用 **Investment Tracker**。

手动安装：从 [Releases](https://github.com/BugStack27/obsidian-investment/releases) 下载 `main.js`、`manifest.json`、`styles.css`，放入 `<库>/.obsidian/plugins/investment-tracker/`，重启 Obsidian 后启用。

> 使用过旧插件标识的库：把 `<库>/.obsidian/plugins/obsidian-investment/` 目录改名为 `investment-tracker`，设置文件 `data.json` 随目录一起迁移。

> BRAT 安装的是已发布的 Release。如果 Release 仍是 draft，需要先手动发布。

### 隐私与数据访问

- **不是完全离线**：净值历史、实时行情与 K 线通过 Obsidian 的 `requestUrl` 从第三方财经接口拉取（东方财富 `datacenter-web.eastmoney.com`、新浪 `hq.sinajs.cn`，以及内置的 [stock-sdk](https://stock-sdk.linkdiary.cn) 客户端所使用的接口）。
- **会发出去的内容**：只有查询用的证券代码——被统计的基金 / 股票代码、盘中估值批量查询时拼接的基金代码列表，以及你在「添加基金 / 添加股票」搜索框里输入的关键词。
- **不会发出去**：笔记正文、文件名、库路径、账号信息一律不上传；没有埋点、统计与崩溃上报，作者侧也没有服务器。
- **读什么**：只读基金 / 股票笔记的 frontmatter（`fund_code` / `stock_code`、标签）与其中 `fund-record` / `stock-record` 代码块的行，用于计算持仓与收益；其它笔记和附件不会被读取。
- **写什么**：只写由你触发的记录块内容与插件自己的 `data.json`，不会删除或改写笔记中的其它内容。
- **缓存**：净值 / 行情只缓存在内存里（见设置「净值缓存时长」），不落盘。
- **已知风险**：`stock-sdk` 在浏览器端通过注入 `<script>` 加载东方财富数据以规避 CORS，因此本插件依赖这些站点提供的第三方脚本；若你的 Obsidian 因内容安全策略拦截，需在 `src/services/stockSdk.ts` 切换网络传输方式。

### 兼容性

- Obsidian `1.7.2` 及以上。
- 桌面端与移动端均可使用（数据层用 `requestUrl`，不依赖 Node 接口）。
- 行情、净值与搜索需要联网；记录本身只存在笔记里，离线时仍可读，图表与收益回退到缓存或最近一次的数据。
- 设置页在 Obsidian 1.13.0 及以上使用声明式设置（可被设置搜索检索），更早的版本回退到经典设置页。

### 开发

```bash
npm install     # 安装依赖
npm run dev     # 监听构建，输出 main.js
npm run build   # 类型检查 + 生产构建
npm run lint    # ESLint 检查
```

源码位于 `src/`，构建产物为 `main.js`（不纳入版本控制）。

本地调试时，把 `main.js`、`manifest.json`、`styles.css` 复制到 `<库>/.obsidian/plugins/investment-tracker/`，重载 Obsidian 即可。

### 发布

```bash
npm version patch   # 同步更新 package.json、manifest.json、versions.json，并打 tag
git push --follow-tags
```

推送 tag 后，GitHub Actions 会执行类型检查与构建，生成 `main.js`、`manifest.json`、`styles.css` 的 Release（draft），并记录构建证明。确认无误后手动发布该 Release。

### 说明

- 数据源依赖东方财富/新浪公开接口，需联网；净值、估值可能因缓存或接口限流延迟更新。
- 基金收益口径含分红；暂不含管理费（如后续需要可扩展管理费设置）。股票支持 A 股实时行情与前复权 K 线。

### 许可

[0-BSD](LICENSE)
