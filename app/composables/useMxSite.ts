import type { SiteConfig } from '~/types/site'
import { staticSiteConfig } from '~/utils/mx/adapter'

/**
 * 站点配置。
 *
 * 走 Nitro 缓存的 `/api/mx/site`（10 分钟），它内部已做「聚合 → 站点元数据」两级降级；
 * 仍失败时在这里退到 blog.config.ts 的静态值——**首屏永远有值，不会因为 core 挂了而白屏**。
 *
 * 返回 AsyncData，用法：`const { data: site } = await useMxSite()`
 */
export function useMxSite() {
	// 前缀版按语言取（core 按语言换 SEO 文字）；换语言时先沿用站点语言那一份，免得闪回静态值
	const lang = useRouteLang()
	return useAsyncData<SiteConfig>(
		() => langKeyOf('mx-site-config', lang.value),
		() => $fetch<SiteConfig>('/api/mx/site', { query: { lang: lang.value } }).catch(() => staticSiteConfig()),
		{ default: () => (lang.value && useNuxtData<SiteConfig>('mx-site-config').data.value) || staticSiteConfig() },
	)
}

/**
 * 正在跑的 core 的版本（侧栏技术信息用），取不到时是空串。
 * 只在浏览器里取：这一行在挂件里默认收起的「构建信息」中，不值得让 SSR 多等一次 core
 */
export function useMxCoreVersion() {
	return useAsyncData(
		'mx-core-version',
		() => $fetch<{ core: string }>('/api/mx/version').then(res => res.core).catch(() => ''),
		{ server: false, lazy: true, default: () => '' },
	)
}
