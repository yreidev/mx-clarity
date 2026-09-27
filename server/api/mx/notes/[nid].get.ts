import { uiLangOfClient } from '~~/app/utils/mx/client'
import { loadNoteDetail } from '~~/app/utils/mx/notes'

/** 日记详情。不缓存，转发访客 IP；加密日记返回 `{ locked: true }` */
export default defineEventHandler(async (event) => {
	const nid = getRouterParam(event, 'nid') ?? ''
	// 从 1 开始的正整数；/notes/abc 这类地址在页面里得到 0，这里直接 404
	if (!/^[1-9]\d{0,8}$/.test(nid))
		throw notFound()
	try {
		// 前缀版带 ?lang=<语言>，看原文带 ?lang=original
		const lang = await requestLangOf(event, { allowOriginal: true })
		const client = useServerMxClient(event, { lang })
		const detail = await loadNoteDetail(client, Number(nid))
		// 股票、地图块的数据在服务端取好嵌进去
		if ('body' in detail)
			await hydrateRichBlocks(detail.body, uiLangOfClient(client))
		return detail
	}
	catch (error) {
		throw toHttpError(error)
	}
})
