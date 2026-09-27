import { staticSiteConfig } from '~~/app/utils/mx/adapter'
import { buildAtomFeed } from '~~/app/utils/mx/feed'
import { loadFeedThinking } from '~~/app/utils/mx/feed-data'
import blogConfig from '~~/blog.config'

/** 碎碎念的订阅源，最新 20 条，纯文本；缓存 10 分钟 */
export default defineCachedEventHandler(async (event) => {
	const [site, thinking, timeZone] = await Promise.all([
		getCachedSiteConfig().catch(() => staticSiteConfig()),
		loadFeedThinking(useServerMxClient()).catch((error) => {
			throw toHttpError(error, 'feed-thinking')
		}),
		getSiteTimeZone(),
	])
	setFeedHeaders(event)
	return buildAtomFeed({ ...feedSiteOf(site, timeZone, blogConfig.language), title: `${site.title} · 碎碎念` }, thinking, '/thinking/atom.xml')
}, { name: 'mx-feed-thinking', maxAge: 600, swr: true, getKey: () => 'atom' })
