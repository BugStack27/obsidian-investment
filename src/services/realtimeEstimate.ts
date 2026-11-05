import { requestUrl } from 'obsidian';

export interface RealtimeEstimate {
	fundCode: string;
	name: string;
	/** 估算净值 */
	gsz: number;
	/** 估算涨跌幅（%） */
	gszzl: number;
	/** 估值时间 HH:mm:ss */
	gztime: string;
	/** 估值日期 YYYY-MM-DD */
	date: string;
}

interface CacheEntry {
	expireAt: number;
	value: RealtimeEstimate | null;
}

const cache = new Map<string, CacheEntry>();
const TTL = 60_000;

/**
 * 批量获取基金盘中实时估值（新浪 hq.sinajs.cn fu_ 接口）。
 * 返回 GBK 编码，需带 Referer 防盗链头；requestUrl 走主进程网络栈，无 CORS 限制。
 * 单只基金失败/无数据时静默跳过，不阻塞主流程。
 */
export async function fetchRealtimeEstimates(codes: string[]): Promise<Map<string, RealtimeEstimate>> {
	const now = Date.now();
	const result = new Map<string, RealtimeEstimate>();
	const missing: string[] = [];

	for (const code of codes) {
		const hit = cache.get(code);
		if (hit && hit.expireAt > now) {
			if (hit.value) result.set(code, hit.value);
		} else {
			missing.push(code);
		}
	}
	if (missing.length === 0) return result;

	try {
		const url = `https://hq.sinajs.cn/list=${missing.map((c) => `fu_${c}`).join(',')}`;
		const resp = await requestUrl({
			url,
			headers: { Referer: 'https://finance.sina.com.cn' },
		});
		const text = new TextDecoder('gbk').decode(resp.arrayBuffer);
		const parsed = new Map<string, RealtimeEstimate>();
		for (const line of text.split('\n')) {
			const m = line.match(/hq_str_fu_(\d+)="(.*)"/);
			if (!m) continue;
			const f = m[2]!.split(',');
			const est: RealtimeEstimate = {
				fundCode: m[1]!,
				name: f[0] ?? '',
				gsz: parseFloat(f[2] ?? ''),
				gszzl: parseFloat(f[6] ?? ''),
				gztime: f[1] ?? '',
				date: f[7] ?? '',
			};
			const valid = Number.isFinite(est.gsz) && est.gsz > 0;
			cache.set(m[1]!, { expireAt: now + TTL, value: valid ? est : null });
			if (valid) parsed.set(m[1]!, est);
		}
		for (const code of missing) {
			const v = parsed.get(code);
			if (v) result.set(code, v);
		}
	} catch {
		// 网络失败静默降级
	}
	return result;
}
