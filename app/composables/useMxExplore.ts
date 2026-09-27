import type { ArticleDetail } from '~/types/article'
import type { FeedGroup } from '~/types/feed'
import type { ReadingBoard } from '~/types/live'
import type { ProjectProps } from '~/types/project'
import type { SearchPage } from '~/types/search'
import type { BlogStats } from '~/types/stats'
import type { TimelineEntry } from '~/types/timeline'
import type { MxClient } from '~/utils/mx/client'
import { pageErrorOf } from '~/utils/mx/errors'
import { applyLink, linkErrorOf, parseLinkApplication } from '~/utils/mx/links'
import { loadSearch } from '~/utils/mx/search'

/**
 * 时间线、项目、友链、独立页、统计、搜索页是页面数据，走本站的 server 路由（服务端渲染、可缓存）；
 * 搜索弹窗与友链申请在浏览器里直连 core，客户端由组件传进来（`useCoreClient()`）。
 */

export function useMxTimeline() {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData(() => langKeyOf('mx-timeline', lang.value), () => fetcher<TimelineEntry[]>('/api/mx/timeline', { query: { lang: lang.value } }), { default: () => [] })
}

export function useMxProjects() {
	const fetcher = useRequestFetch()
	return useAsyncData('mx-projects', () => fetcher<ProjectProps[]>('/api/mx/projects'), { default: () => [] })
}

export function useMxLinks() {
	const fetcher = useRequestFetch()
	return useAsyncData('mx-links', () => fetcher<{ groups: FeedGroup[], banned?: string[], canApply: boolean }>('/api/mx/links'))
}

/**
 * 页脚的「正在阅读」、归档页的「阅读最多」与文章头部「N 人在读」共用的一份：此刻在读、阅读最多、每篇的在读人数。只在浏览器里取
 */
export function useMxReadingBoard() {
	return useLazyFetch<ReadingBoard>('/api/mx/reading', { key: 'mx-reading', server: false })
}

/** 统计挂件只在侧栏里用，不阻塞首屏 */
export function useMxStats() {
	return useLazyFetch<BlogStats>('/api/mx/stats', { key: 'mx-stats' })
}

/**
 * 独立页。与文章详情共用 key 规则（`mxPostKey`），`useArticle()` 据此找到目录给侧栏挂件。
 * slug 为空（多段地址等）时不请求，直接返回 null；
 * `optional` 时 404 不算错误，也返回 null——友链页用它取可选的「申请须知」
 */
export function useMxPage(slug: MaybeRefOrGetter<string>, options: { optional?: boolean, original?: MaybeRefOrGetter<boolean> } = {}) {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData<ArticleDetail | null>(
		() => mxPostKey(localePath(`/${toValue(slug)}`, lang.value)),
		async () => toValue(slug)
			? fetcher<ArticleDetail>(`/api/mx/pages/${encodeURIComponent(toValue(slug))}`, { query: { lang: toValue(options.original) ? ORIGINAL_LANG : lang.value } }).catch((error) => {
					if (options.optional && (error as { statusCode?: number }).statusCode === 404)
						return null
					throw error
				})
			: null,
	)
}

/** 搜索弹窗在浏览器里按关键词直连 core 取，不走 useAsyncData */
export function searchSite(core: () => MxClient, keyword: string, page = 1) {
	return callCore(() => loadSearch(core(), keyword, page), pageErrorOf)
}

/** 友链申请：先按 core 的上限校验，不合要求时抛出带提示文案的错误 */
export function applyForLink(core: () => MxClient, form: Record<string, string>) {
	const application = parseLinkApplication(form)
	if (typeof application === 'string')
		throw createError({ statusCode: 400, message: application, data: { message: application } })
	return callCore(() => applyLink(core(), application), linkErrorOf)
}

/** 搜索页：服务端渲染，关键词、页码变了自动重取；没有关键词时不请求 */
export function useMxSearch(keyword: MaybeRefOrGetter<string>, page: MaybeRefOrGetter<number>) {
	const fetcher = useRequestFetch()
	return useAsyncData<SearchPage | null>(
		() => `mx-search:${toValue(page)}:${toValue(keyword)}`,
		() => toValue(keyword)
			? fetcher<SearchPage>('/api/mx/search', { query: { keyword: toValue(keyword), page: toValue(page) } })
			: Promise.resolve(null),
	)
}

/** 侧栏导航里的独立页，取不到时为空 */
export function useMxPageLinks() {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData(() => langKeyOf('mx-page-links', lang.value), () => fetcher<{ title: string, path: string }[]>('/api/mx/pages', { query: { lang: lang.value } }), { default: () => [] })
}
