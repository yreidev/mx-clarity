import type { ReadingBoard } from '~~/app/types/live'
import { loadReadingNow, publicReadingOnly, READING_BOARD_SIZE, topReadFrom } from '~~/app/utils/mx/explore'

/**
 * 此刻在读：core 的房间人数只缓存 3 秒，过期后不先给旧的。读者进了房间要很快算进去，
 * 不然刚打开文章、马上去看页脚的人会看到过时的「没人在读」（打开页面时取的那次还没进房间）
 */
const getReadingNow = defineCachedFunction(
	() => loadReadingNow(useServerMxClient()),
	{ name: 'mx-reading-now', maxAge: 3, swr: false, getKey: () => 'now' },
)

/**
 * 页脚的「正在阅读」、归档页的「阅读最多」、文章头部的「N 人在读」：正在阅读来自 core 的房间人数，阅读最多来自缓存的文章列表与时间线。
 * 正在阅读只留公开清单里的地址：已发布的文章、时间线里游客可见的日记、导航里的独立页。
 * 哪一半拿不到就给空列表，不让整块失败
 */
export default defineEventHandler(async (): Promise<ReadingBoard> => {
	const [now, articles, timeline, pages] = await Promise.all([
		getReadingNow().catch(() => []),
		getCachedArticles().catch(() => []),
		getCachedTimeline().catch(() => []),
		getCachedPageLinks().catch(() => []),
	])
	const publicPaths = [
		...articles.map(article => article.path),
		...timeline.filter(entry => entry.type === 'note').map(entry => entry.path),
		...pages.map(page => page.path),
	]
	const reading = publicReadingOnly(now, publicPaths)
	return {
		now: reading.slice(0, READING_BOARD_SIZE),
		top: topReadFrom(articles, timeline),
		counts: Object.fromEntries(reading.map(entry => [entry.path, entry.count])),
	}
})
