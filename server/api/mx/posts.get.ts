import type { ArticleProps } from '~~/app/types/article'

/**
 * 全部已发布文章的卡片数据：首页、归档、前后篇共用。
 * 缓存在 `getCachedArticles` 里；正文算完阅读时间就丢，不返回给页面。
 */
export default defineEventHandler(async (event): Promise<ArticleProps[]> => {
	try {
		return await getCachedArticles(await requestLangOf(event))
	}
	catch (error) {
		throw toHttpError(error)
	}
})
