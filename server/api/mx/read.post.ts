import { reportRead } from '~~/app/utils/mx/explore'
import { resolveVisitorIp } from '~~/app/utils/mx/ip'
import { createTtlSet } from '~~/app/utils/mx/live'
import { msg } from '~~/shared/utils/i18n'

/**
 * 同一 IP 同一篇 30 分钟内只转一次：core 的 `/ack` 每调一次加一，没有任何去重。
 * 浏览器那边同一会话也只报一次，这里防的是绕过页面直接刷。
 * 先记下再转（同时来的两次只转一次），转给 core 失败了就撤销，下次还能报上
 */
const seen = createTtlSet(30 * 60 * 1000, 20_000)

/** 上报一次阅读。只收同源的 JSON 请求，转发访客 IP */
export default defineEventHandler(async (event) => {
	assertSameOriginJson(event)
	const body = await readBody<{ kind?: unknown, id?: unknown }>(event).catch(() => undefined)
	const kind = body?.kind === 'post' || body?.kind === 'note' ? body.kind : undefined
	const id = snowflakeOf(body?.id)
	if (!kind || !id)
		throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: msg('common.invalidParameters') })

	const source = useRuntimeConfig(event).mxClientIpHeader === 'x-real-ip' ? 'x-real-ip' : 'x-forwarded-for'
	const ip = resolveVisitorIp(event.node.req.headers, event.node.req.socket?.remoteAddress, source) ?? 'unknown'
	const key = `${ip}:${kind}:${id}`
	if (!seen.add(key))
		return { counted: false }
	try {
		await reportRead(useServerMxClient(event), kind, id)
		return { counted: true }
	}
	catch (error) {
		seen.delete(key)
		throw toHttpError(error)
	}
})
