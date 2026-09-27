import type { ArticleDetail } from '~~/app/types/article'
import { articleFromPost, languagesOf, tagGlossaryOf, tagNamesOf, translationOf } from '~~/app/utils/mx/adapter'
import { uiLangOfClient } from '~~/app/utils/mx/client'
import { pickAuthCookies } from '~~/app/utils/mx/cookie'
import { contentExtrasOf } from '~~/app/utils/mx/extras'
import { paywallFrom } from '~~/app/utils/mx/membership'
import { renderPostBody } from '~~/app/utils/mx/render'

/**
 * 文章详情：`ArticleProps` + 渲染好的正文 AST 与目录（路径 A 或 B）。
 *
 * 不缓存：`$meta` 按请求者计算。转发这次请求的访客 IP（core 按访客限流）。
 * 付费文章谁能读看读者会话，所以转发读者的 Better Auth cookie；
 * 付费文章的响应因人而异，标成 `private, no-store`，不让任何共享缓存存下全文。
 */

export default defineEventHandler(async (event): Promise<ArticleDetail> => {
	// 分类与 slug 会拼进发往 core 的路径，先挡住能改写路径的字符与点段
	const category = segmentOf(getRouterParam(event, 'category', { decode: true }))
	const slug = segmentOf(getRouterParam(event, 'slug', { decode: true }))
	if (!category || !slug)
		throw notFound()

	// 前缀版带 ?lang=<语言>（在主题配置开了的语言里才认），看原文带 ?lang=original，其余一律按站点语言取
	const lang = await requestLangOf(event, { allowOriginal: true })
	const client = useServerMxClient(event, { withReaderSession: true, lang })
	const [post, options] = await Promise.all([
		client.post.getPost(encodeURIComponent(category), encodeURIComponent(slug)).catch((error) => {
			throw toHttpError(error)
		}),
		articleMappingOptions(),
	])
	const paywall = paywallFrom(post.$meta)
	// 付费文章因人而异；带登录 cookie 的请求（站长能看到草稿）同样不许共享缓存存下
	if (paywall || pickAuthCookies(getHeader(event, 'cookie')))
		setHeader(event, 'cache-control', 'private, no-store')
	// Lexical 文章走路径 A，其余与解析失败的走路径 B；股票、地图块的数据在服务端取好嵌进去
	// 正文里主题生成的文字（占位、链接卡片的属性名、地图的距离……）跟这一版的界面语言
	const ui = uiLangOfClient(client)
	const rendered = await renderPostBody(post, { enrichments: (post.$meta as { enrichments?: unknown } | undefined)?.enrichments, ui })
	await hydrateRichBlocks(rendered.body, ui)
	const article = articleFromPost(post, options)
	const tagNames = tagNamesOf(article.tags, tagGlossaryOf(post.$meta))
	return {
		article: tagNames ? { ...article, tagNames } : article,
		translation: translationOf(post.$meta, post.id),
		languages: languagesOf(post.$meta, post.id),
		...rendered,
		paywall,
		extras: contentExtrasOf(post.meta, post.$meta, { locked: paywall?.locked }),
	}
})
