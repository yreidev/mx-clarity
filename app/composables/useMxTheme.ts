import type { ThemeConfig } from '~/types/theme'
import { Temporal } from 'temporal-polyfill'
import { defaultThemeConfig, footerCopyrightOf } from '~/utils/mx/theme'

/**
 * 主题配置（admin 里的片段 `theme/mx-clarity`）。走缓存 60 秒的 `/api/mx/theme`，读不到时是默认值。
 * `app/plugins/mx-site.ts` 在首屏前已取过，组件里直接 `const { data: theme } = useMxTheme()` 即可
 */
export function useMxTheme() {
	// 前缀版合上 `theme/<名字>.<语言>` 的覆盖；换语言时先沿用站点语言那一份
	const lang = useRouteLang()
	return useAsyncData<ThemeConfig>(
		() => langKeyOf('mx-theme-config', lang.value),
		() => $fetch<ThemeConfig>('/api/mx/theme', { query: { lang: lang.value } }).catch(() => defaultThemeConfig()),
		{ default: () => (lang.value && useNuxtData<ThemeConfig>('mx-theme-config').data.value) || defaultThemeConfig() },
	)
}

/**
 * 站点时区：`/api/mx/theme` 下发的生效值（主题配置 ＞ 主题进程的 `TZ` ＞ UTC），服务端渲染与浏览器一致。
 * 日期的换算、格式化、分年与「今天」都用它，不用读者浏览器的时区
 */
export function useSiteTimeZone() {
	const { data: theme } = useMxTheme()
	return computed(() => theme.value.timeZone || 'UTC')
}

/** 默认的分享图：主题配置的 `ogImage`，没配就用站长头像。没有封面的页面用它 */
export function useDefaultOgImage() {
	const { data: site } = useMxSite()
	const { data: theme } = useMxTheme()
	return computed(() => theme.value.ogImage || site.value.author.avatar || undefined)
}

/** 页脚的版权文字：`{year}`、`{author}` 换成站点时区的今年与站长名 */
export function useFooterCopyright() {
	const { data: site } = useMxSite()
	const { data: theme } = useMxTheme()
	const timeZone = useSiteTimeZone()
	return computed(() => footerCopyrightOf(theme.value.footer.copyright, site.value.author.name, Temporal.Now.plainDateISO(timeZone.value).year))
}

/** 随 mx 与主题配置变化的 `<head>`：站点图标（含深色）、作者、站点关键词、站长加的脚本、站名字体 */
export function useMxThemeHead() {
	const { data: site } = useMxSite()
	const { data: theme } = useMxTheme()
	useHead(() => {
		const font = theme.value.header.titleFont
		const icon = site.value.icon || '/favicon.svg'
		const keywords = keywordsText(site.value.keywords)
		return {
			link: [
				{ key: 'site-icon', rel: 'icon', href: icon },
				// admin 里另设了深色图标：深色模式的标签页用它
				...(site.value.iconDark && site.value.iconDark !== icon
					? [{ key: 'site-icon-dark', rel: 'icon' as const, href: site.value.iconDark, media: '(prefers-color-scheme: dark)' }]
					: []),
			],
			meta: [
				{ key: 'site-author', name: 'author', content: site.value.author.name },
				// 文章页的 useSeoMeta 会用文章自己的关键词盖掉它
				...(keywords ? [{ name: 'keywords' as const, content: keywords }] : []),
			],
			script: theme.value.scripts.map(s => ({ key: `theme-script:${s.src}`, src: s.src, defer: s.defer, async: s.async })),
			// family、url 都已按白名单净化（utils/mx/theme.ts），这里只做 CSS 字符串转义
			style: font ? [{ key: 'title-font', innerHTML: `@font-face{font-family:${JSON.stringify(font.family)};src:url(${JSON.stringify(font.url)});font-display:swap}` }] : [],
		}
	})
}
