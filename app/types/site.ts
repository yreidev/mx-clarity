/**
 * 站点级配置的本地类型。
 * 页面与组件只认它，不认 api-client 的 `AggregateRoot`。
 */

/** 数据来自哪一级降级链：完整聚合 → 站点元数据 → blog.config.ts 静态值 */
export type SiteConfigSource = 'aggregate' | 'site' | 'static'

export interface SiteConfig {
	source: SiteConfigSource
	title: string
	description: string
	keywords: string[]
	/** 为空时已回退到 blog.config.ts 的 favicon */
	icon: string
	iconDark: string
	author: {
		name: string
		avatar: string
	}
	/** mx 配置里的前台地址（`url.webUrl`），feed / sitemap 的绝对地址也取它 */
	webUrl: string
	/** mx 配置里 core 的地址（`url.serverUrl`，如 `https://example.com/api/v3`）；拿不到时为空串 */
	serverUrl: string
	/** 站长在「主人信息」里填的社交账号，已拼成固定格式的地址（只认得几个平台） */
	social: { icon: string, text: string, url: string }[]
	/** 站长的一句话介绍（纯文本），主题配置没填副标题时用它 */
	introduce: string
	comments: {
		enabled: boolean
		allowGuest: boolean
	}
}
