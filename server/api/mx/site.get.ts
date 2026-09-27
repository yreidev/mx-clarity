/**
 * 站点配置。缓存在 server/utils/mx.ts 的 getCachedSiteConfig 里，
 * 这样列表、详情路由取分类映射时也能复用同一份。
 */
export default defineEventHandler(async (event) => {
	try {
		return await getCachedSiteConfig(await requestLangOf(event))
	}
	catch (error) {
		throw createError({ statusCode: 503, statusMessage: 'mx core unavailable', cause: error })
	}
})
