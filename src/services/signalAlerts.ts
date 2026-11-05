import type { SignalDetail } from '../utils/signalCalc';

/** 信号处理状态：确认或忽略（仅当天有效） */
export type SignalStatus = 'confirmed' | 'ignored';

/** 聚合后的信号条目（含基金标识，供状态栏与处理弹窗使用） */
export interface SignalItem extends SignalDetail {
	code: string;
	name: string;
	filePath: string;
}

/** 本地日期 YYYY-MM-DD（A 股同区，用于信号跨天重置） */
export function todayKey(d = new Date()): string {
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * 信号展示窗口守卫：每天下午 13:00 之后才统计/展示买卖信号。
 * 盘中通道信号在午盘数据落定前（13:00 前）不够可靠，故状态栏徽标在此之前不显示。
 */
export function isSignalWindow(d = new Date()): boolean {
	return d.getHours() >= 13;
}