import { CHART_COLORS } from './theme';
import { echarts } from './echartsInit';
import type { ChartOption } from './echartsInit';
import type { HoldingSummary, NetWorthRecord, ResolvedTransaction } from '../../types';

/**
 * 逐净值日推进，累计持有份额/累计净投入/加权成本，输出累计收益与持有收益。
 * 与移动端 NavChart.tsx 内 calcDailyProfitData 口径一致。
 */
interface DaySerial {
	cumProfit: number;
	holdProfit: number;
	/** 截至该净值日的加权平均持仓成本（元/份） */
	avgCost: number;
}

function calcSerialData(
	netWorths: NetWorthRecord[],
	transactions: ResolvedTransaction[],
): DaySerial[] {
	const sortedTxns = [...transactions]
		.filter((t) => !t.pending && (t.type === 'buy' || t.type === 'sell'))
		.sort((a, b) => a.date.localeCompare(b.date));
	let cumShares = 0;
	let cumInvested = 0;
	let totalBuyCost = 0;
	let totalBuyShares = 0;
	let txnIdx = 0;
	const result: DaySerial[] = [];
	for (const rec of netWorths) {
		while (txnIdx < sortedTxns.length && sortedTxns[txnIdx]!.date <= rec.date) {
			const t = sortedTxns[txnIdx]!;
			if (t.type === 'buy') {
				cumShares += t.shares;
				cumInvested += t.amount;
				totalBuyCost += t.amount;
				totalBuyShares += t.shares;
			} else {
				cumShares -= t.shares;
				cumInvested -= t.amount;
			}
			txnIdx++;
		}
		const avgCost = totalBuyShares > 0 ? totalBuyCost / totalBuyShares : 0;
		result.push({
			cumProfit: cumShares * rec.netWorth - cumInvested,
			holdProfit: cumShares * rec.netWorth - cumShares * avgCost,
			avgCost,
		});
	}
	return result;
}

/** 买卖标记点：x 轴索引 + 净值 + 同日合并后的交易金额（不含手续费） */
interface TxMarker {
	index: number;
	date: string;
	nav: number;
	amount: number;
	type: 'buy' | 'sell';
}

/**
 * 取某类交易落在净值日上的标记点：跳过待确认交易，同日多笔合并为一条并累加金额
 * （与趋势通道图 `trendChannel.ts` 的标记口径一致）。
 */
function txMarkers(
	transactions: ResolvedTransaction[],
	dateIndex: Map<string, number>,
	netWorths: NetWorthRecord[],
	type: 'buy' | 'sell',
): TxMarker[] {
	const byIndex = new Map<number, TxMarker>();
	for (const tx of transactions) {
		if (tx.pending || tx.type !== type) continue;
		const idx = dateIndex.get(tx.date);
		if (idx == null) continue;
		const hit = byIndex.get(idx);
		if (hit) hit.amount += tx.amount;
		else
			byIndex.set(idx, {
				index: idx,
				date: tx.date,
				nav: netWorths[idx]!.netWorth,
				amount: tx.amount,
				type,
			});
	}
	return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * 净值走势图：线索 + 渐变面积 + 持仓成本线 + 买卖标记点。
 * tooltip（x 轴触发）在命中的净值日上额外展示当日买入/卖出金额（同日多笔已合并累加）。
 * option 结构与移动端 NavChart.tsx 完全一致。
 */
export function buildNavOption(
	netWorths: NetWorthRecord[],
	transactions: ResolvedTransaction[],
	summary: HoldingSummary | null,
): ChartOption {
	const dates = netWorths.map((r) => r.date);
	const dateIndex = new Map<string, number>();
	netWorths.forEach((r, i) => dateIndex.set(r.date, i));

	const serial = calcSerialData(netWorths, transactions);
	const navData = netWorths.map((r, i) => ({
		value: r.netWorth,
		_date: r.date,
		_change: r.netWorthChange / 100,
		_cumProfit: serial[i]?.cumProfit ?? 0,
		_holdProfit: serial[i]?.holdProfit ?? 0,
		_avgCost: serial[i]?.avgCost ?? 0,
	}));

	const markLineData: Array<Record<string, unknown>> = [];
	if (summary && summary.avgCostPerShare > 0) {
		markLineData.push({
			yAxis: summary.avgCostPerShare,
			lineStyle: { color: CHART_COLORS.profit, type: 'dashed', width: 1 },
			label: {
				formatter: `持仓成本 ${summary.avgCostPerShare.toFixed(4)}`,
				position: 'insideEndBottom',
				fontSize: 9,
				color: CHART_COLORS.profit,
				padding: [10, 0, 0, 0],
			},
		});
		// 累计成本线（累计投入 / 持有份额）：仅在严格高于持仓成本时叠加，同色系靠线型与标签位置区分
		const cumulativeCost =
			summary.holdShares > 0 ? summary.totalInvested / summary.holdShares : null;
		if (
			cumulativeCost != null &&
			Number.isFinite(cumulativeCost) &&
			cumulativeCost > 0 &&
			cumulativeCost > summary.avgCostPerShare
		) {
			markLineData.push({
				yAxis: cumulativeCost,
				lineStyle: { color: CHART_COLORS.profit, type: 'dotted', width: 1 },
				label: {
					formatter: `累计成本 ${cumulativeCost.toFixed(4)}`,
					position: 'insideEndTop',
					fontSize: 9,
					color: CHART_COLORS.profit,
				},
			});
		}
	}

	const costData = netWorths.map((r, i) => {
		const avgCost = serial[i]?.avgCost ?? 0;
		// 首次买入前无持仓，成本用 null 断档，避免在 0 处画出无意义线段
		return { value: avgCost > 0 ? avgCost : null, _avgCost: avgCost };
	});

	const series: Array<Record<string, unknown>> = [
		{
			type: 'line',
			name: '净值',
			data: navData,
			smooth: false,
			showSymbol: false,
			lineStyle: { color: CHART_COLORS.navLine, width: 2 },
			// 渐变色由 CHART_COLORS.navLine(#475569) 按不同透明度派生
			areaStyle: {
				color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
					{ offset: 0, color: 'rgba(71, 85, 105, 0.15)' },
					{ offset: 1, color: 'rgba(71, 85, 105, 0)' },
				]),
			},
			markLine:
				markLineData.length > 0
					? { silent: true, symbol: 'none', data: markLineData }
					: undefined,
			z: 2,
		},
		{
			type: 'line',
			name: '持仓成本',
			data: costData,
			smooth: false,
			step: 'end',
			showSymbol: false,
			lineStyle: { color: CHART_COLORS.secondary, width: 1.5 },
			z: 3,
		},
	];

	const pushScatter = (markers: TxMarker[], color: string, inner: boolean): void => {
		if (markers.length === 0) return;
		series.push({
			type: 'scatter',
			name: '',
			data: markers.map((m) => ({
				value: [dates[m.index], m.nav],
				// 仅内圈实心点携带元数据供 tooltip 展示买卖金额；外圈光晕不带，避免同一笔重复显示
				...(inner ? { _date: m.date, _nav: m.nav, _amount: m.amount, _type: m.type } : {}),
				itemStyle: inner ? { color } : { color, opacity: 0.15 },
			})),
			symbol: 'circle',
			// 尺寸取小：买卖密集时避免标记点遮挡净值曲线
			symbolSize: inner ? 5 : 8,
			itemStyle: inner ? { opacity: 0.9 } : { opacity: 0.15 },
			silent: !inner,
			z: inner ? 5 : 4,
		});
	};

	const buy = txMarkers(transactions, dateIndex, netWorths, 'buy');
	const sell = txMarkers(transactions, dateIndex, netWorths, 'sell');
	// 成对渲染：背景光晕圈 + 实心圈，复刻移动端效果
	pushScatter(buy, CHART_COLORS.profit, false);
	pushScatter(buy, CHART_COLORS.profit, true);
	pushScatter(sell, CHART_COLORS.loss, false);
	pushScatter(sell, CHART_COLORS.loss, true);

	const option = {
		grid: { left: 12, right: 12, top: 12, bottom: 24 },
		xAxis: {
			type: 'category',
			data: dates,
			boundaryGap: false,
			axisLine: { show: false },
			axisTick: { show: false },
			axisLabel: { fontSize: 9, color: CHART_COLORS.textTertiary },
			splitLine: { show: false },
		},
		yAxis: {
			type: 'value',
			scale: true,
			splitLine: { lineStyle: { color: CHART_COLORS.borderLight, width: 1 } },
			axisLabel: {
				fontSize: 9,
				color: CHART_COLORS.textTertiary,
				formatter: (v: number) => v.toFixed(4),
			},
			axisLine: { show: false },
			axisTick: { show: false },
		},
		series,
		dataZoom: [{ type: 'inside', start: 0, end: 100, minSpan: 5 }],
		tooltip: {
			trigger: 'axis',
			axisPointer: { type: 'cross' },
			backgroundColor: CHART_COLORS.bgCard,
			borderColor: CHART_COLORS.borderLight,
			borderWidth: 1,
			textStyle: { fontSize: 11, color: CHART_COLORS.textPrimary },
			formatter: (params: unknown) => {
				const arr = params as Array<{ data?: Record<string, unknown> }>;
				if (!arr || arr.length === 0) return '';
				const data = arr[0]?.data;
				if (!data || data._date === undefined) return '';
					const dateStr = data._date as string;
				const value = data.value as number;
				const change = data._change as number;
				const cumProfit = data._cumProfit as number;
				const holdProfit = data._holdProfit as number;
				const avgCost = data._avgCost as number;
				const changeColor = change >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
				const profitColor = cumProfit >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
				const holdColor = holdProfit >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss;
				const changeSign = change >= 0 ? '+' : '';
				const profitSign = cumProfit >= 0 ? '+' : '';
				const holdSign = holdProfit >= 0 ? '+' : '';
				const mono = "font-family:'Geist Mono',monospace";
				let html = `<div style="font-weight:600;margin-bottom:4px;${mono};color:${CHART_COLORS.textPrimary}">${dateStr}</div>
<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.textTertiary}">净值</span><span style="color:${CHART_COLORS.textPrimary};${mono}">${value.toFixed(4)}</span></div>
<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.textTertiary}">涨跌</span><span style="color:${changeColor};${mono}">${changeSign}${(change * 100).toFixed(2)}%</span></div>
<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.textTertiary}">累计收益</span><span style="color:${profitColor};${mono}">${profitSign}¥${cumProfit.toFixed(2)}</span></div>
<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.textTertiary}">持有收益</span><span style="color:${holdColor};${mono}">${holdSign}¥${holdProfit.toFixed(2)}</span></div>${avgCost > 0 ? `<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${CHART_COLORS.secondary}">持仓成本</span><span style="color:${CHART_COLORS.textPrimary};${mono}">${avgCost.toFixed(4)}</span></div>` : ''}`;

				// 当日买卖点金额：仅内圈实心散点带 _type/_amount（外圈光晕与折线数据无此字段，自动跳过）
				for (const p of arr) {
					const d = p.data;
					if (!d) continue;
					const type = d._type;
					if (type !== 'buy' && type !== 'sell') continue;
					// 日期兜底比对，防止跨分类误匹配
					if (d._date !== dateStr) continue;
					const amount = Number(d._amount);
					if (!Number.isFinite(amount) || amount <= 0) continue;
					const isBuy = type === 'buy';
					const color = isBuy ? CHART_COLORS.profit : CHART_COLORS.loss;
					const label = isBuy ? '买入金额' : '卖出金额';
					const sign = isBuy ? '-' : '+';
					html += `<div style="display:flex;justify-content:space-between;gap:16px;"><span style="color:${color};font-weight:500">${label}</span><span style="color:${color};${mono};font-weight:600">${sign}¥${amount.toFixed(2)}</span></div>`;
				}
				return html;
			},
			extraCssText:
				'border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:8px 12px;',
		},
	};

	return option;
}