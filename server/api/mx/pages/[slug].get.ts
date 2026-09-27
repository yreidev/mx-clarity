import { uiLangOfClient } from '~~/app/utils/mx/client'
import { loadPageDetail } from '~~/app/utils/mx/pages'

/** 独立页。与文章详情一样不缓存、转发访客 IP */
export default defineEventHandler(async (event) => {
	const slug = segmentOf(getRouterParam(event, 'slug', { decode: true }))
	if (!slug)
		throw notFound()
	try {
		// 前缀版带 ?lang=<语言>，看原文带 ?lang=original
		const lang = await requestLangOf(event, { allowOriginal: true })
		const client = useServerMxClient(event, { lang })
		const detail = await loadPageDetail(client, encodeURIComponent(slug))
		await hydrateRichBlocks(detail.body, uiLangOfClient(client))
		return detail
	}
	catch (error) {
		throw toHttpError(error)
	}
})
