/*
配色与移动端 invest-app 的 theme/index.ts 保持一致，以确保图表视觉完全相同。
*/

export const CHART_COLORS = {
	primary: '#C53D43',
	profit: '#E54D4E',
	loss: '#2EAE6D',
	secondary: '#3B82F6',
	/** 净值曲线专用：刻意不使用红色主色，避免与买卖标记点（买入红/卖出绿）冲突 */
	navLine: '#475569',
	textPrimary: '#1A1D26',
	textSecondary: '#6B7280',
	textTertiary: '#9CA3AF',
	borderLight: '#F0F1F5',
	bgCard: '#FFFFFF',
	bgInput: '#F0F1F5',
} as const;