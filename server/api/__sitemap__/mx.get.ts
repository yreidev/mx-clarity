import { loadSitemapEntries } from '~~/app/utils/mx/explore'
import { loadTopics } from '~~/app/utils/mx/notes'
import { tagCountsOf, tagPath } from '~~/shared/utils/article'

/**
 * `@nuxtjs/sitemap` 的动态源：mx 里全部文章、日记、独立页的路径，另加专栏页与标签页（它们是动态路由，模块收不到）。
 * 缓存 1 小时；core 自己对 sitemap 接口也缓存 1 小时（实测 `s-maxage=3600`）。专栏、标签拿不到时少这两类
 */
export default defineCachedEventHandler(async () => {
	const client = useServerMxClient()
	const [entries, topics, articles] = await Promise.all([
		loadSitemapEntries(client).catch((error) => {
			throw toHttpError(error)
		}),
		loadTopics(client).catch(() => []),
		getCachedArticles().catch(() => []),
	])
	return [
		...entries,
		...topics.map(topic => ({ loc: topic.path })),
		...tagCountsOf(articles).map(tag => ({ loc: tagPath(tag.name) })),
	]
}, { name: 'mx-sitemap', maxAge: 3600, swr: true, getKey: () => 'all' })
