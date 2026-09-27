import { staticSiteConfig } from '~~/app/utils/mx/adapter'
import { buildAtomFeed } from '~~/app/utils/mx/feed'
import { loadFeedSays } from '~~/app/utils/mx/feed-data'
import blogConfig from '~~/blog.config'

/** 说说的订阅源，最新 20 条，纯文本；缓存 10 分钟 */
export default defineCachedEventHandler(async (event) => {
	const [site, says, timeZone] = await Promise.all([
		getCachedSiteConfig().catch(() => staticSiteConfig()),
		loadFeedSays(useServerMxClient()).catch((error) => {
			throw toHttpError(error, 'feed-says')
		}),
		getSiteTimeZone(),
	])
	setFeedHeaders(event)
	return buildAtomFeed({ ...feedSiteOf(site, timeZone, blogConfig.language), title: `${site.title} · 说说` }, says, '/says/atom.xml')
}, { name: 'mx-feed-says', maxAge: 600, swr: true, getKey: () => 'atom' })
