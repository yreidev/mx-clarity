import type { ThemeConfig } from '~/types/theme'

/**
 * 多语言的前缀版（`/en/...`）：只有主题配置 `i18n.languages` 开了的语言才有，其余 404（与不存在的地址一样）。
 * 开了哪些语言取一次站点语言的主题配置，记在 `useState` 里
 */
export default defineNuxtRouteMiddleware(async (to) => {
	if (to.params.lang === undefined)
		return
	const enabled = useState<string[] | undefined>('mx-content-langs', () => undefined)
	enabled.value ??= await $fetch<ThemeConfig>('/api/mx/theme').then(theme => theme.i18n.languages, () => [])
	const lang = routeLangOf(to.params.lang)
	if (!lang || !enabled.value.includes(lang))
		return abortNavigation(createError({ statusCode: 404, statusMessage: 'Page Not Found' }))
})
