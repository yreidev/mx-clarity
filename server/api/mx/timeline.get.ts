/** 时间线：文章与日记混排，一次拿全，缓存 10 分钟 */
export default defineEventHandler(async event => getCachedTimeline(await requestLangOf(event)).catch((error) => {
	throw toHttpError(error)
}))
