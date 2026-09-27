import type { SiteConfig } from '~/types/site'
import type { ThemeConfig } from '~/types/theme'
import { staticSiteConfig } from '~/utils/mx/adapter'
import { defaultThemeConfig } from '~/utils/mx/theme'

/**
 * 实时活动的连接，页脚的在线人数与各页的「正在阅读」共用这一条。
 * 等水合完成再连：数字提前到了会让页面渲染得和服务端不一致。
 * 映射新评论要的站点与主题配置从页面已经取到的数据里读（按当前页面的语言），不另外请求
 */
export default defineNuxtPlugin(() => {
	const config = useRuntimeConfig()
	const nuxt = useNuxtApp()
	const router = useRouter()
	const core = useCoreClient({ anonymous: true })

	function pageData<T>(key: string, fallback: () => T) {
		const lang = routeLangOf(router.currentRoute.value.params.lang)
		return (nuxt.payload.data[langKeyOf(key, lang)] ?? nuxt.payload.data[key] ?? fallback()) as T
	}
	const site = () => pageData<SiteConfig>('mx-site-config', staticSiteConfig)
	const theme = () => pageData<ThemeConfig>('mx-theme-config', defaultThemeConfig)

	onNuxtReady(() => startMxLive({
		apiUrl: config.public.mxBrowserApiUrl || '/api/v3',
		core,
		commentOptions: () => commentMapOptionsOf(site(), theme()),
		ownerName: () => site().author.name,
	}))
})
