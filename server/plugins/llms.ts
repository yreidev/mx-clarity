import { loadNotePage } from '~~/app/utils/mx/notes'

/**
 * `/llms.txt`（nuxt-llms）的内容改取 mx：站名、描述用站点配置，列出全部文章、最新一页日记（摘要是 core 的 AI 摘要）与独立页。
 * 原先由 Nuxt Content 喂，列的是上游作者的文章
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('llms:generate', async (_event, options) => {
		const [site, articles, notes, pages] = await Promise.all([
			getCachedSiteConfig().catch(() => undefined),
			getCachedArticles().catch(() => []),
			loadNotePage(useServerMxClient(), 1).then(page => page.items).catch(() => []),
			getCachedPageLinks().catch(() => []),
		])
		if (site) {
			options.title = site.title
			options.description = site.description
			options.domain = site.webUrl
		}
		const base = site?.webUrl || options.domain
		options.sections = [
			{
				title: '文章',
				links: articles.map(article => ({
					title: article.title ?? article.path,
					href: new URL(article.path, base).href,
					description: article.description,
				})),
			},
			{
				title: '日记',
				links: notes.map(note => ({ title: note.title, href: new URL(note.path, base).href, description: note.excerpt })),
			},
			{
				title: '页面',
				links: pages.map(page => ({ title: page.title, href: new URL(page.path, base).href })),
			},
		].filter(section => section.links.length)
	})
})
