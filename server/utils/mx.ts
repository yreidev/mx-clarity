/**
 * server 端取 mx 数据的公共部分：复用 app/utils/mx 的 client 与映射，
 * 不直接 import api-client。
 */
import type { H3Event } from 'h3'
import type { ThemeConfig } from '~~/app/types/theme'
import type { ArticleMappingOptions } from '~~/app/utils/mx/adapter'
import type { MxFetch } from '~~/app/utils/mx/client'
import type { PublicIndex } from '~~/app/utils/mx/home'
import { createMxClient, SITE_LANG } from '~~/app/utils/mx/client'
import { pickAuthCookies } from '~~/app/utils/mx/cookie'
import { classifyMxError, pageErrorOf } from '~~/app/utils/mx/errors'
import { loadTimeline } from '~~/app/utils/mx/explore'
import { publicIndexOf } from '~~/app/utils/mx/home'
import { resolveVisitorIp } from '~~/app/utils/mx/ip'
import { loadPageLinks } from '~~/app/utils/mx/pages'
import { loadAllArticles } from '~~/app/utils/mx/posts'
import { loadCoreVersion, loadSiteConfig } from '~~/app/utils/mx/site'
import { defaultThemeConfig, loadThemeConfig, THEME_CANDIDATES } from '~~/app/utils/mx/theme'
import { resolveTimeZone } from '~~/shared/utils/time'

interface ServerMxClientOptions {
	/** 把访客的 Better Auth 会话 cookie 转给 core。只在内容因人而异时开（付费正文、会员、精读） */
	withReaderSession?: boolean
	/** 取 AI 译文的原文时用原文的语言，其余都是站点语言 */
	lang?: string
}

/** 服务端请求 core 都经这里：失败时记下时刻，这段时间渲染的页面不进整页缓存（server/utils/core-health.ts） */
const coreFetch: MxFetch = (url, options) => $fetch(url, options).catch((error: unknown) => {
	if (isCoreFetchFailure(error))
		noteCoreFailure({ kind: 'unavailable' })
	throw error
})

/**
 * 传入 event 时从这次请求自己的头里取访客 IP（取法由 NUXT_MX_CLIENT_IP_HEADER 定），新建 `X-Forwarded-For` 发给 core；
 * 全站共享的缓存数据不传 event，core 看到的是 Nuxt 服务器自己。
 * 访客的浏览器标识与来源一概不转：服务端请求用 Node 默认的 UA，core 当它是爬虫、不记进访问统计
 * （页面会被整页缓存，服务端取数本来就代表不了哪位读者；读者自己的访问由浏览器直连 core 的请求记）。
 */
export function useServerMxClient(event?: H3Event, options: ServerMxClientOptions = {}) {
	const config = useRuntimeConfig(event)
	let headers: Record<string, string> | undefined
	if (event) {
		headers = {}
		const ip = visitorIpOf(event)
		if (ip)
			headers['x-forwarded-for'] = ip
		const cookie = options.withReaderSession ? pickAuthCookies(event.node.req.headers.cookie) : undefined
		if (cookie)
			headers.cookie = cookie
	}
	return createMxClient({
		baseURL: config.mxApiUrl,
		fetch: coreFetch,
		headers,
		lang: options.lang,
		timeout: 5000,
		maxRetryWaitMs: 2000,
	})
}

/** 访客的 IP（取法由 NUXT_MX_CLIENT_IP_HEADER 定），转给 core、主题自己限速都用它 */
export function visitorIpOf(event: H3Event) {
	const source = useRuntimeConfig(event).mxClientIpHeader === 'x-real-ip' ? 'x-real-ip' : 'x-forwarded-for'
	return resolveVisitorIp(event.node.req.headers, event.node.req.socket?.remoteAddress, source)
}

/**
 * 按语言分键的缓存：`lang` 是校验过的内容语言（`requestLangOf`），不给就是站点语言，键与多语言之前一样。
 * 白名单外的值到不了这里，条目数 = 生效语言数 × 原键数
 */
const langKey = (fallback: string) => (lang?: string) => lang ?? fallback
const langClient = (lang?: string) => useServerMxClient(undefined, { lang })

/** 站点配置，全站缓存 10 分钟（按语言分：core 按语言换 SEO 文字）。失败不进缓存，已有缓存时 swr 继续返回旧值 */
export const getCachedSiteConfig = defineCachedFunction(
	async (lang?: string) => {
		try {
			// 第一级（/aggregate）失败、退到 /aggregate/site 时记一条
			return await loadSiteConfig(langClient(lang), error => logDegraded('site-config', classifyMxError(error)))
		}
		catch (error) {
			logDegraded('site-config-fallback', classifyMxError(error))
			throw error
		}
	},
	{ name: 'mx-site-config', maxAge: 600, swr: true, getKey: langKey('default') },
)

/**
 * 全部已发布文章的卡片：首页、归档、前后篇、统计、llms.txt 共用，一分钟最多打 core 一轮。
 * 固定键：查询参数不能用来击穿缓存
 */
export const getCachedArticles = defineCachedFunction(
	async (lang?: string) => loadAllArticles(langClient(lang), await articleMappingOptions()),
	{ name: 'mx-articles', maxAge: 60, swr: true, getKey: langKey('all') },
)

/** 时间线：文章与日记混排、一次拿全（core 只给游客可见的日记），全站缓存 10 分钟；按语言分（标题是译文） */
export const getCachedTimeline = defineCachedFunction(
	(lang?: string) => loadTimeline(langClient(lang)),
	{ name: 'mx-timeline', maxAge: 600, swr: true, getKey: langKey('all') },
)

/** 侧栏导航里的独立页，缓存 10 分钟；按语言分（标题是译文） */
export const getCachedPageLinks = defineCachedFunction(
	(lang?: string) => loadPageLinks(langClient(lang)),
	{ name: 'mx-page-links', maxAge: 600, swr: true, getKey: langKey('all') },
)

/**
 * 主题配置（admin 里的片段 `theme/mx-clarity`，也认 `theme/yohaku`、`theme/shiro`），全站缓存 60 秒：站长改完一分钟内生效。
 * 先走 `/aggregate?theme=`，失败（没有可见日记时 404）退回 `/s/theme/<名字>`。
 * 读不到时（core 不可用）抛出，swr 下继续返回上一次的值；从没读到过就由调用方退回默认值
 */
export const getCachedThemeConfig = defineCachedFunction(
	async (lang?: string) => {
		const config = useRuntimeConfig()
		const base = config.mxApiUrl
		const client = langClient(lang)
		const { config: theme, warnings } = await loadThemeConfig({
			aggregate: async () => (await client.aggregate.getAggregateData<unknown>(THEME_CANDIDATES.join('|'))).theme,
			snippet: name => $fetch(`${base}/s/theme/${name}`, { query: { lang: lang ?? SITE_LANG }, timeout: 5000, retry: 0 }),
		}, lang ?? SITE_LANG).catch((error) => {
			logDegraded('theme-config', classifyMxError(error))
			throw error
		})
		for (const warning of warnings)
			logEvent('warn', 'mx.theme-config', { warning })
		return theme
	},
	{ name: 'mx-theme-config', maxAge: 60, swr: true, getKey: langKey('default') },
)

/** 主题进程的时区：环境变量 `TZ`（镜像默认 `Asia/Shanghai`），没设就是运行环境的默认 */
function processTimeZone() {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * 主题配置，`timeZone` 换成生效的站点时区（主题配置 ＞ `TZ` ＞ UTC）；读不到主题配置时用默认值。
 * 带语言时合上 `theme/<名字>.<语言>` 的覆盖，但开了哪些语言（`i18n`）与时区始终以站点语言的那一份为准
 */
export async function getThemeConfigWithTimeZone(lang?: string): Promise<ThemeConfig> {
	const base = await getCachedThemeConfig().catch(() => defaultThemeConfig())
	const theme = lang ? await getCachedThemeConfig(lang).catch(() => base) : base
	return { ...theme, i18n: base.i18n, timeZone: resolveTimeZone(base.timeZone, processTimeZone()) }
}

/** 生效的站点时区，服务端按年分组、算「今天」时用 */
export async function getSiteTimeZone() {
	return (await getThemeConfigWithTimeZone()).timeZone
}

/** core 的版本（侧栏技术信息用），缓存 1 小时。取不到时抛出，由调用方当成空串 */
export const getCachedCoreVersion = defineCachedFunction(
	async () => {
		const config = useRuntimeConfig()
		const base = config.mxApiUrl
		return loadCoreVersion(path => $fetch(`${base}${path}`, { timeout: 5000, retry: 0 }))
	},
	{ name: 'mx-core-version', maxAge: 3600, swr: true, getKey: () => 'default' },
)

/**
 * 评论头像额外认的域名：站点自己（单域名部署时，上传到 core 的文件在站点域名下）与站长头像所在的域名。
 * 取不到站点配置时只认固定的几个头像服务
 */
export async function trustedAvatarHosts(): Promise<string[]> {
	const site = await getCachedSiteConfig().catch(() => undefined)
	return [site?.webUrl, site?.author.avatar].flatMap((url) => {
		try {
			return url ? [new URL(url).hostname] : []
		}
		catch {
			return []
		}
	})
}

/**
 * 公开内容的索引：已发布的文章、时间线里游客可见的日记、导航里的独立页（都来自缓存）。
 * core 的聚合、动态、房间接口按 id 取标题，不看发布状态与密码，标题与地址都要先在这里对上
 */
export async function getPublicIndex(): Promise<PublicIndex> {
	const [articles, timeline, pages] = await Promise.all([
		getCachedArticles().catch(() => []),
		getCachedTimeline().catch(() => []),
		getCachedPageLinks().catch(() => []),
	])
	return publicIndexOf([
		...articles.map(article => ({ path: article.path, title: article.title })),
		...timeline.filter(entry => entry.type === 'note').map(entry => ({ path: entry.path, title: entry.title })),
		...pages.map(page => ({ path: page.path, title: page.title })),
	])
}

/** 分类 → 文章版式：主题配置里的在前，app.config 的兜底 */
export async function articleMappingOptions(): Promise<ArticleMappingOptions> {
	const theme = await getCachedThemeConfig().catch(() => undefined)
	const fromTheme = Object.fromEntries((theme?.categories ?? []).filter(c => c.type).map(c => [c.name, c.type]))
	return { typeByCategory: [fromTheme, useAppConfig().articleTypeByCategory] }
}

/** mx 请求失败 → 页面该收到的 HTTP 错误；message 只有固定文案 */
export function toHttpError(error: unknown, source = 'route') {
	const failure = classifyMxError(error)
	logDegraded(source, failure)
	return createError({ ...pageErrorOf(failure), data: { kind: failure.kind } })
}
