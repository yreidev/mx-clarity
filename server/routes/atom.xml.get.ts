import { staticSiteConfig } from '~~/app/utils/mx/adapter'
import { classifyMxError } from '~~/app/utils/mx/errors'
import { buildAtomFeed } from '~~/app/utils/mx/feed'
import { loadFeedNotes, loadFeedPosts } from '~~/app/utils/mx/feed-data'
import blogConfig from '~~/blog.config'

/**
 * 订阅源：主题自己生成 Atom，站名、地址取 mx 的配置。文章与日记各取最新一页，带全文（付费文章只放摘要）；缓存 10 分钟。
 * 哪一部分拿不到就少那一部分，不让整个订阅源失败
 */
export default defineCachedEventHandler(async (event) => {
	const site = await getCachedSiteConfig().catch(() => staticSiteConfig())
	const client = useServerMxClient()
	const [posts, notes, timeZone] = await Promise.all([
		articleMappingOptions().then(options => loadFeedPosts(client, site.webUrl, options)).catch((error) => {
			logDegraded('feed-posts', classifyMxError(error))
			return []
		}),
		loadFeedNotes(client, site.webUrl).catch((error) => {
			logDegraded('feed-notes', classifyMxError(error))
			return []
		}),
		getSiteTimeZone(),
	])
	setFeedHeaders(event)
	return buildAtomFeed(feedSiteOf(site, timeZone, blogConfig.language), [...posts, ...notes])
}, { name: 'mx-feed', maxAge: 600, swr: true, getKey: () => 'atom' })
