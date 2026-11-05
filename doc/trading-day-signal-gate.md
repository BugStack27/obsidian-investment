---
date: 2026-09-20
description: 买卖信号接入 stock-sdk 交易日历（calendar.isTradingDay），非交易日不计算、不提醒
status: accepted
---

# 买卖信号交易日门控 — 决策记录

> 状态：✅ 已验收（2026-09-20）

## 1. 目标与范围
买卖信号原先只做时间窗口过滤（≥13:00）与星期判断，节假日仍会基于陈旧净值算出信号并弹出徽标。本次接入 stock-sdk 的 A 股交易日历（含节假日识别），使非交易日不计算信号、不提醒、也不轮询盘中估值。交易日行为与改动前完全等价。

## 2. 关键决策
| 决策点 | 结论 | 理由 |
|------|------|------|
| 非交易日跳过程度 | 完全跳过计算，`card.signal` 恒为 `null` | 派生出的信号列表为空，徽标/状态栏/弹窗自然全空；历史买卖点标记不受影响 |
| 接口失败兜底 | 回退「周一至周五即交易日」 | 漏报危害大于误报；节假日误报概率远低于接口偶发失败 |
| 判定结果缓存 | 每天判定一次；跨天失效；失败值按 10 分钟 TTL 重试 | 避免每次刷新都打接口，又能自愈 |
| 盘中估值守卫是否统一 | 一并改为「交易日 && 交易时段」，删除旧的 `isTradingTime` | 避免两份时段口径并存；节假日不再轮询估值接口 |
| 时间窗口守卫 | `isSignalWindow()`（≥13:00）保持不变，与交易日取交集 | 交易日 13:00 前仍不显示，非交易日全天不显示 |
| 提醒出口门控 | 状态栏条件显式加 `s.tradingDay` | 让「非交易日不提醒」在 UI 层显式成立，防后续回归 |

## 3. 交付物
| 文件（相对路径） | 职责 |
|------|------|
| `src/services/stockSdk.ts` | `fetchTradingDay` 薄封装 `calendar.isTradingDay`，不含缓存、不吞异常 |
| `src/services/tradingCalendar.ts` | `isWeekdayTradingFallback`、`isTradingSession`、`isTradingDayToday`（每日缓存 + 失败回退 + TTL 重试 + 并发去重） |
| `src/services/portfolioOverview.ts` | `buildFundCards` 新增 `computeSignals` 选项，关闭时短路不调 `computeTrendChannelSignal` |
| `src/data/investmentStore.ts` | 快照新增 `tradingDay`；`refresh` 前置判定并透传；`refreshEstimates` 守卫拆分 |
| `src/main.ts` | `renderStatusBar` 徽标条件加交易日门控 |
| `src/services/realtimeEstimate.ts` | 删除 `isTradingTime`（时段判断迁入 `tradingCalendar`） |

## 4. 关键修正与教训
- **缓存命中条件必须区分跨天与临时值** → 仅 `provisional` 值走 TTL，成功值当天永久有效；TTL 未到时不得重发请求。
- **失败分支必须写 10 分钟临时值而非永久值** → 否则一次接口抖动会让当天剩余时间全部走星期兜底。
- **`computeSignals` 默认必须为 `true`** → 其他调用方行为才能不变；短路顺序需保证 `false` 时右侧不求值。
- **`SignalModal` 仅由状态栏徽标点击构造** → 徽标缺席即无绕过入口，无需额外空列表守卫。

## 5. 已知边界
- 交易日判定是串行前置请求，每天首次刷新产生一次网络往返（stock-sdk 超时 20s），此后命中缓存零成本。
- `isTradingSession` 为纯本地时间判断（周一至周五 9:30-15:00），不含节假日——节假日由 `isTradingDayToday` 另行拦截。
- `SignalModal` 在空列表时不崩溃，渲染标题 + 空列表 + 底部提示，降级可接受。

## 6. 后续候选
- 开启 `noUnusedLocals` / `noUnusedParameters` 以自动拦截死代码。
