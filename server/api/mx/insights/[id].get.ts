import { loadInsights } from '~~/app/utils/mx/insights'

/**
 * 一篇文章或日记的 AI 洞察，只读库里已有的（`onlyDb`），绝不让 core 当场生成。
 * 付费文章要读者身份才能读：转读者 cookie，响应因人而异，不进任何缓存
 */
export default defineEventHandler(async (event) => {
	setHeader(event, 'cache-control', 'private, no-store')
	const id = snowflakeOf(getRouterParam(event, 'id'))
	if (!id)
		throw notFound()
	try {
		return await loadInsights(useServerMxClient(event, { withReaderSession: true }), id)
	}
	catch (error) {
		throw toHttpError(error, 'insights')
	}
})
