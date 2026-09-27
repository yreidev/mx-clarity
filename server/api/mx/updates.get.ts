import type { SiteUpdates } from '~~/app/types/stats'
import { updatesSince } from '~~/app/utils/mx/explore'

/**
 * 上次来访之后的新内容（首页的「有新内容」提示）：`since` 是浏览器记下的毫秒时间。
 * 从缓存的文章列表与时间线算，不打 core；结果随 since 变，不缓存
 */
export default defineEventHandler(async (event): Promise<SiteUpdates> => {
	setHeader(event, 'cache-control', 'no-store')
	const since = Number(getQuery(event).since)
	const [articles, timeline] = await Promise.all([
		getCachedArticles().catch(() => []),
		getCachedTimeline().catch(() => []),
	])
	return updatesSince(articles, timeline, since)
})
