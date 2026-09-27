import { loadSearch, SEARCH_KEYWORD_MAX } from '~~/app/utils/mx/search'
import { msg } from '~~/shared/utils/i18n'

/**
 * 站内搜索。**不缓存**：关键词任意，进缓存等于让人随便占内存；core 这个接口本身也不缓存。
 * 转发访客 IP，限流算在访客头上
 */
export default defineEventHandler(async (event) => {
	const raw = getQuery(event).keyword
	const keyword = typeof raw === 'string' ? raw.trim() : ''
	if (!keyword || keyword.length > SEARCH_KEYWORD_MAX)
		throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: msg('search.enterKeywordUp') }) // 与 SEARCH_KEYWORD_MAX 一致；页面显示时过 t()，文案里不能带变量
	try {
		return await loadSearch(useServerMxClient(event), keyword, pageOf(event))
	}
	catch (error) {
		throw toHttpError(error)
	}
})
