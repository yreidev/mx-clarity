import { uiLangOfClient } from '~~/app/utils/mx/client'
import { loadNoteDetail } from '~~/app/utils/mx/notes'
import { msg } from '~~/shared/utils/i18n'

/**
 * 用密码打开加密日记。密码走请求体，不进页面网址与访问日志；
 * 由服务端带给 core（core 只认查询参数 `?password=`）。
 * 语言与详情接口一样：前缀版带 `?lang=<语言>`、看原文带 `?lang=original`，解锁后的正文与占位文字跟着这一版
 */
export default defineEventHandler(async (event) => {
	const nid = getRouterParam(event, 'nid') ?? ''
	// 从 1 开始的正整数；/notes/abc 这类地址在页面里得到 0，这里直接 404
	if (!/^[1-9]\d{0,8}$/.test(nid))
		throw notFound()
	// 与其他写接口一样只收本站页面发来的 JSON
	assertSameOriginJson(event)
	const body = await readBody<{ password?: unknown }>(event).catch(() => undefined)
	const password = typeof body?.password === 'string' ? body.password : ''
	if (!password || password.length > 256)
		throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: msg('note.pleaseEnterPassword') })
	const client = useServerMxClient(event, { lang: await requestLangOf(event, { allowOriginal: true }) })
	let detail
	try {
		detail = await loadNoteDetail(client, Number(nid), password)
	}
	catch (error) {
		throw toHttpError(error)
	}
	// core 对「密码错误」与「没带密码」返回同一个 403，这里只能说密码不对
	if (detail.locked)
		throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: msg('note.wrongPassword') })
	// 密码对了但还没到公开时间：照样不给内容，页面按定时公开显示
	if ('body' in detail)
		await hydrateRichBlocks(detail.body, uiLangOfClient(client))
	return detail
})
