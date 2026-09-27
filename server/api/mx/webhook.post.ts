import { cachesForEvent, verifyWebhookSignature } from '~~/app/utils/mx/webhook'
import { msg } from '~~/shared/utils/i18n'

/**
 * core 的 webhook：内容变了就清对应的缓存，不用等过期。密钥读 `NUXT_MX_WEBHOOK_SECRET`，没设时这个接口当不存在（404）。
 * 服务器之间的请求，不做同源检查；对请求体的**原始字节**验签，不对回 401（4xx 不会让 core 重试）。
 * 不记 payload（里面有付费全文、评论者的邮箱与 IP），也不用它填缓存
 */
export default defineEventHandler(async (event) => {
	const secret = String(useRuntimeConfig(event).mxWebhookSecret ?? '')
	if (!secret)
		throw notFound()
	const body = await readRawBody(event, false) ?? ''
	if (!verifyWebhookSignature(body, getHeader(event, 'x-webhook-signature256'), secret))
		throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: msg('error.invalidSignature') })
	const name = String(getHeader(event, 'x-webhook-event') ?? '')
	let payload: unknown
	try {
		payload = JSON.parse(body.toString())
	}
	catch {}
	const caches = cachesForEvent(name, payload)
	if (!caches)
		return { ok: true, ignored: true }
	const purged = await purgeCaches(caches)
	logEvent('info', 'mx.webhook', { webhookEvent: name, purged })
	return { ok: true }
})
