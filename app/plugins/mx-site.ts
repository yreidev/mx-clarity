/**
 * 站点名、地址与描述以 mx 后台为准。
 *
 * 必须在插件阶段做：nuxt-seo-utils 的插件初始化时就把 site config 拍成快照写进 head
 * （标题后缀 `%siteName`、canonical、og:site_name），在页面或 app.vue 里再改已经来不及。
 * `enforce: 'pre'` 让它排在那个插件之前；core 不可用时保留 blog.config 的值。
 *
 * 页面语言（`<html lang>` 与 og:locale）也由 nuxt-seo-utils 按 site config 的 `currentLocale` 写，页面里的 useHead 盖不过它：
 * 这里给一个跟着路由前缀变的值（zh-CN、en-US、ja-JP、ko-KR），站内跳转时一起变
 */
export default defineNuxtPlugin({
	name: 'mx-site-config',
	enforce: 'pre',
	dependsOn: ['nuxt-site-config:init'],
	async setup() {
		const router = useRouter()
		updateSiteConfig({ currentLocale: computed(() => localeOf(uiLangOf(routeLangOf(router.currentRoute.value.params.lang)))) })
		const [{ data: site }] = await Promise.all([useMxSite(), useMxTheme()])
		if (site.value.source !== 'static')
			updateSiteConfig({ name: site.value.title, url: site.value.webUrl, description: site.value.description })
	},
})
