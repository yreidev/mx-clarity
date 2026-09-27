import { statsFrom } from '~~/app/utils/mx/explore'

/** 统计挂件，由缓存的文章列表与时间线算，不打 core；缓存 10 分钟 */
export default defineCachedEventHandler(async () => {
	const [articles, timeline, timeZone] = await Promise.all([
		getCachedArticles(),
		getCachedTimeline().catch(() => []),
		getSiteTimeZone(),
	]).catch((error) => {
		throw toHttpError(error)
	})
	return statsFrom(articles, timeline, timeZone)
}, { name: 'mx-stats', maxAge: 600, swr: true, getKey: () => 'all' })
