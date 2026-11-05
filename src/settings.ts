import { App, PluginSettingTab, Setting } from 'obsidian';
import type InvestmentPlugin from './main';
import type { TrendChannelConfigValues } from './ui/charts/trendChannel';

/** 净值/收益走势图区间 */
export type ChartRangeKey = '6m' | '1y' | '3y' | 'all';

/** 单条信号处理记录：recordDate 为记录日期，其余字段为 code → 状态；日期与今日不一致即全部失效 */
export interface SignalStatusRecord {
	recordDate: string;
	[code: string]: string;
}

export interface InvestmentSettings {
	/** 净值数据内存缓存时长（小时） */
	navCacheHours: number;
	/** 通过插件打开基金笔记时默认采用编辑（源码）模式；false 为阅读（预览）模式 */
	openFundInEdit: boolean;
	/** 净值/收益走势图默认区间，用户切换后持久化 */
	chartRange: ChartRangeKey;
	/** 各基金的趋势通道指标配置（code → 配置），channel 分析卡内修改后按基金持久化 */
	trendChannelConfig: Record<string, TrendChannelConfigValues>;
	/** 当日买卖信号的处理状态：recordDate 不一致时全部失效，新记录时自动清空 */
	signalStatusRecord?: SignalStatusRecord;
}

export const DEFAULT_SETTINGS: InvestmentSettings = {
	navCacheHours: 6,
	openFundInEdit: false,
	chartRange: '1y',
	trendChannelConfig: {},
	signalStatusRecord: { recordDate: '' },
};

export class InvestmentSettingTab extends PluginSettingTab {
	plugin: InvestmentPlugin;

	constructor(app: App, plugin: InvestmentPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('投资插件设置').setHeading();

		new Setting(containerEl)
			.setName('净值缓存时长')
			.setDesc('基金净值从 stock-sdk 拉取后的内存缓存时长（小时），避免频繁刷新。')
			.addSlider((slider) =>
				slider
					.setLimits(1, 24, 1)
					.setValue(this.plugin.settings.navCacheHours)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.navCacheHours = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('基金/股票笔记默认打开模式')
			.setDesc('通过插件打开基金/股票笔记（从侧栏"全部基金"卡片点击、"近期操作"列表点击、或"添加基金/股票"新建后）时，默认使用编辑模式还是阅读模式；开启 = 编辑模式，关闭 = 阅读模式。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openFundInEdit)
					.onChange(async (value) => {
						this.plugin.settings.openFundInEdit = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}