import { msg } from '~~/shared/utils/i18n'

/**
 * 主题自己的写接口（阅读上报、加密日记解锁……）请求体都很小；评论、点赞这些交互浏览器直连 core，不经这里。
 * h3 的 `readBody` 会把整个请求体读进内存、不设上限，这里先看 Content-Length：
 * 没有（分块传输）或超过 64 KB 的直接 413，不读。浏览器发的 JSON 请求都带 Content-Length。
 * 只有 core 发来的 webhook 放到 4 MB
 */
const MAX_BODY = 64 * 1024
/** core 的 webhook 带着整篇文章或日记（Lexical 的 JSON 不小），单独放宽 */
const MAX_WEBHOOK_BODY = 4 * 1024 * 1024
const READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler((event) => {
	if (READ_ONLY.has(event.method) || !event.path.startsWith('/api/mx/'))
		return
	const max = event.path.split('?')[0] === '/api/mx/webhook' ? MAX_WEBHOOK_BODY : MAX_BODY
	const length = Number(getHeader(event, 'content-length'))
	if (!Number.isInteger(length) || length < 0 || length > max)
		throw createError({ statusCode: 413, statusMessage: 'Payload Too Large', message: msg('error.requestTooLarge') })
})
