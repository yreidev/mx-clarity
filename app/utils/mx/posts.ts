/**
 * 拉取全部已发布文章并映射成卡片数据。
 */
import type { ArticleProps } from '../../types/article'
import type { ArticleMappingOptions } from './adapter'
import type { MxClient } from './client'
import { articleFromPost, languagesOf, tagGlossaryOf, tagNamesOf } from './adapter'

/** core 的列表接口把 `size` 静默截到 50（`post.repository.ts:114`），按实际上限取 */
export const POST_PAGE_SIZE = 50
/** 防御性上限，5000 篇 */
const MAX_PAGES = 100
/** 第一页之后同时取几页：不串行等，也不一下子把 core 打满 */
const CONCURRENCY = 4

/**
 * 页数以第一页响应里的 `totalPages` 为准，其余页每批 4 页并发取，结果按页序拼。
 * 不带 `truncate`：要正文算阅读时间
 */
export async function loadAllArticles(client: MxClient, options: ArticleMappingOptions = {}) {
	type Page = Awaited<ReturnType<MxClient['post']['getList']>>
	const fetchPage = (page: number) => client.post.getList(page, POST_PAGE_SIZE)
	const first = await fetchPage(1)
	const total = Math.min(MAX_PAGES, Math.max(1, first.pagination?.totalPages ?? 1))
	const pages: Page[] = [first]
	for (let start = 2; start <= total; start += CONCURRENCY) {
		const batch = Array.from({ length: Math.min(CONCURRENCY, total - start + 1) }, (_, i) => start + i)
		pages.push(...await Promise.all(batch.map(fetchPage)))
	}
	return pages.flatMap((res) => {
		// 带 ?lang= 取时 $meta 里有每篇是不是译文、这一页标签的译名（前缀版的卡片标记与标签名用）
		const meta = (res as { $meta?: unknown }).$meta
		const glossary = tagGlossaryOf(meta)
		return res.data.map((post): ArticleProps => {
			const article = articleFromPost(post, options)
			const tagNames = tagNamesOf(article.tags, glossary)
			return {
				...article,
				...(languagesOf(meta, post.id)?.translated ? { translated: true } : {}),
				...(tagNames ? { tagNames } : {}),
			}
		})
	})
}
