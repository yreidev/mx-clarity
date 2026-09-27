import type { H3Event } from 'h3'
import type { SiteConfig } from '~~/app/types/site'
import type { FeedSite } from '~~/app/utils/mx/feed'

/**
 * 订阅源的响应头。用 application/xml 而不是 application/atom+xml：浏览器只对前者套用 atom.xsl 渲染成网页（上游同样如此），
 * 阅读器两种都认。渲染出来的页面与站点同源，另给一条严格的内容安全策略
 */
export function setFeedHeaders(event: H3Event) {
	setHeader(event, 'content-type', 'application/xml; charset=utf-8')
	setHeader(event, 'content-security-policy', FEED_CSP)
}

export function feedSiteOf(site: SiteConfig, timeZone: string, language: string): FeedSite {
	return {
		title: site.title,
		description: site.description,
		url: site.webUrl,
		author: site.author,
		icon: site.icon,
		language,
		timeZone,
	}
}
