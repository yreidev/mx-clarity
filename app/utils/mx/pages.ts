/**
 * 独立页与友链列表。纯模块，由 server 路由调用；友链申请在 links.ts（浏览器直连 core 时也要用，不带正文渲染）。
 */
import type { ArticleDetail } from '../../types/article'
import type { FeedGroup } from '../../types/feed'
import type { MxClient } from './client'
import { CANDIDATE_LANGS } from '~~/shared/utils/lang'
import { articleFromPage, bannedLinkNamesFrom, languagesOf, linkGroupsFrom, translationOf } from './adapter'
import { uiLangOfClient } from './client'
import { renderPostBody } from './render'

export async function loadPageDetail(client: MxClient, slug: string): Promise<ArticleDetail> {
	const page = await client.page.getBySlug(slug)
	const $meta = (page as { $meta?: unknown }).$meta
	return {
		article: articleFromPage(page),
		translation: translationOf($meta, page.id),
		languages: languagesOf($meta, page.id),
		...await renderPostBody(page, { enrichments: ($meta as { enrichments?: unknown } | undefined)?.enrichments, ui: uiLangOfClient(client) }),
	}
}

/** 友链分组，另带被封禁的友链名称（只有名称） */
export async function loadLinkGroups(client: MxClient): Promise<{ groups: FeedGroup[], banned: string[] }> {
	const links = await client.link.getAll()
	return { groups: linkGroupsFrom(links), banned: bannedLinkNamesFrom(links) }
}

/** api-client 已从 `{ can }` 里取出布尔值 */
export async function canApplyLink(client: MxClient) {
	return (await client.link.canApplyLink()) === true
}

/**
 * 本站静态路由占用的一级路径（`app/pages/` 下的页面、routeRules、根路由、静态目录与语言前缀 `/en` 等）。
 * 同名的独立页进不了 `/:slug`，也不进导航；`link` 页是友链页上方的说明文字。有单测对着 `app/pages/` 核对
 */
export const RESERVED_PAGE_SLUGS = new Set<string>([
	...CANDIDATE_LANGS,
	'archive',
	'categories',
	'link',
	'membership',
	'notes',
	'posts',
	'preview',
	'projects',
	'says',
	'search',
	'skills',
	'thinking',
	'timeline',
	'api',
	'assets',
	'fonts',
	'images',
])

export interface PageLink {
	title: string
	path: string
}

/** 侧栏导航里的独立页：按 `order` 从小到大，跳过与静态路由同名的 */
export async function loadPageLinks(client: MxClient): Promise<PageLink[]> {
	const res = await client.page.getList(1, 50)
	return [...(res.data ?? [])]
		.filter(page => page.slug && !RESERVED_PAGE_SLUGS.has(page.slug))
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
		.map(page => ({ title: page.title || page.slug, path: `/${encodeURIComponent(page.slug)}` }))
}
