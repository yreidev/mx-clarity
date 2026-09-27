/**
 * 按分类 slug、标签找文章。纯函数，只用文章卡片数据里的 `path`、`categories`、`tags`。
 */
import { delocalizePath } from './lang'
import { safelyDecodeUriComponent } from './link'

interface ArticleLike {
	path: string
	categories?: string[]
	tags?: string[]
	/** 前缀版里标签的译名：原名 → 译名 */
	tagNames?: Record<string, string>
}

/** 分类的 slug 只在文章地址里（`/posts/<分类 slug>/<文章 slug>`）；找不到这个分类下的文章时返回空 */
export function categoryNameOf(list: ArticleLike[], slug: string) {
	const prefix = `/posts/${slug}/`
	return list.find(article => article.path.startsWith(prefix))?.categories?.[0]
}

/** 带这个标签的文章，顺序不变 */
export function articlesWithTag<T extends ArticleLike>(list: T[], tag: string) {
	return list.filter(article => article.tags?.includes(tag))
}

/** 全部标签与各自的篇数：篇数多的在前，一样多按名字排 */
export function tagCountsOf(list: ArticleLike[]) {
	const counts = new Map<string, number>()
	for (const article of list) {
		for (const tag of new Set(article.tags ?? []))
			counts.set(tag, (counts.get(tag) ?? 0) + 1)
	}
	return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}

/** 整份列表里标签的译名（前缀版用）：原名 → 译名，没有译名的不在里面 */
export function tagNamesIn(list: ArticleLike[]) {
	const names: Record<string, string> = {}
	for (const article of list)
		Object.assign(names, article.tagNames)
	return names
}

/** 标签页的地址；标签可能带空格、斜杠等，整段编码 */
export function tagPath(tag: string) {
	return `/posts/tag/${encodeURIComponent(tag)}`
}

/**
 * 文章的真实地址与当前地址不同时要跳去的地址：改过 slug 或分类后，core 按旧地址也能找到这篇（slug tracker），
 * 不跳的话同一篇有两个地址。比较前都解码、去掉末尾的斜杠
 */
export function articleRedirectOf(currentPath: string, articlePath: string | undefined) {
	if (!articlePath)
		return undefined
	const normalize = (path: string) => safelyDecodeUriComponent(path).replace(/\/+$/, '') || '/'
	return normalize(currentPath) === normalize(articlePath) ? undefined : articlePath
}

/**
 * 上一篇、下一篇：在按日期排好的列表里找当前页，返回 `[前一篇, 后一篇]`，找不到是空数组。
 * 前缀版（`/en/posts/…`）先去掉语言前缀，列表里的地址不带前缀；两边都解码再比（`route.path` 是解码过的，列表里是编码的）
 */
export function adjacentArticles<T extends { path: string }>(sorted: readonly T[], routePath: string): [T | undefined, T | undefined] | [] {
	const current = safelyDecodeUriComponent(delocalizePath(routePath))
	const index = sorted.findIndex(article => safelyDecodeUriComponent(article.path) === current)
	return index < 0 ? [] : [sorted[index - 1], sorted[index + 1]]
}

/**
 * 算总字数时这篇记多少：付费文章的正文在列表里被截断，字数只按预览算、偏小，不计入
 */
export function countedWordsOf(article: { premium?: boolean, readingTime?: { words?: number } }) {
	return article.premium ? 0 : article.readingTime?.words ?? 0
}

/** 文章的关键词：mx 的 `meta.keywords`（数组或逗号分隔的字符串），没有就用标签 */
export function articleKeywordsOf(metaKeywords: unknown, tags: string[] | undefined): string[] {
	const own = Array.isArray(metaKeywords)
		? metaKeywords
		: typeof metaKeywords === 'string' ? metaKeywords.split(/[,，]/) : []
	const cleaned = own.filter((k): k is string => typeof k === 'string').map(k => k.trim()).filter(Boolean)
	return cleaned.length ? cleaned : tags ?? []
}

/** `<meta name="keywords">` 的内容：去重、去空，最多 20 个 */
export function keywordsText(keywords: unknown[] | undefined) {
	const list = (keywords ?? []).filter((k): k is string => typeof k === 'string').map(k => k.trim()).filter(Boolean)
	return [...new Set(list)].slice(0, 20).join(', ')
}
