/**
 * 站点名、地址与描述以 mx 后台为准——Nitro 这一侧。
 *
 * `app/plugins/mx-site.ts` 只管页面；sitemap、robots 这些 Nitro 路由读的是每个请求自己的 site config，
 * 不补这一步，它们用的还是 blog.config.ts 里的兜底地址（实测）。
 * core 不可用时什么都不做，保留 blog.config 的值
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('site-config:init', async ({ siteConfig }) => {
		const site = await getCachedSiteConfig().catch(() => undefined)
		if (!site || site.source === 'static')
			return
		siteConfig.push({
			_context: 'mx',
			_priority: 0,
			name: site.title,
			url: site.webUrl,
			description: site.description,
		})
	})
})
