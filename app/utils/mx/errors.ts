/**
 * 把 api-client 抛出的错误归成几类，按 `code` 分支、不匹配 message 文案。
 */
import { RequestError } from '@mx-space/api-client'
import { msg } from '~~/shared/utils/i18n'

/**
 * - `not-found`：资源不存在（错误 URL、文章被删）
 * - `rate-limited`：429，适配器已按 retry-after 重试过一次仍失败
 * - `invalid-request`：422 / 400 等，前端传错了参数，是 bug，开发期要显眼
 * - `unauthorized`：401 / 403，前台调了需要鉴权的端点，是配置错误
 * - `unavailable`：core 不可达、超时、5xx
 */
export type MxFailureKind = 'not-found' | 'rate-limited' | 'invalid-request' | 'unauthorized' | 'unavailable'

export interface MxFailure {
	kind: MxFailureKind
	/** HTTP 状态；网络错误为 0 */
	status: number
	/** core 信封里的 `error.code`，网络错误为 `NETWORK_ERROR` */
	code: string
	message: string
	path?: string
}

export function classifyMxError(error: unknown): MxFailure {
	if (!(error instanceof RequestError)) {
		return { kind: 'unavailable', status: 0, code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }
	}
	const base = { message: error.message, path: error.path }
	// api-client 对没有响应的错误（连不上、超时）也会把 status 兜成 500，只能看原始错误里有没有 response
	if (!(error.raw as { response?: unknown } | undefined)?.response)
		return { ...base, kind: 'unavailable', status: 0, code: 'NETWORK_ERROR' }

	const status = Number(error.status) || 0
	const code = String(error.code ?? status)
	const kind: MxFailureKind
		= status === 404 || code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND')
			? 'not-found'
			: status === 429 || code === 'RATE_LIMITED'
				? 'rate-limited'
				: status === 401 || status === 403
					? 'unauthorized'
					: status >= 500
						? 'unavailable'
						: 'invalid-request'
	return { ...base, kind, status, code }
}

/**
 * 正文那一路请求失败时要抛的页面错误：只有正文失败才出错误页，侧栏、评论等其余部分一律局部降级。
 * 返回值直接交给 Nuxt 的 `createError`。
 *
 * **message 只用固定文案**：blog-v3 的错误页（`Error.vue`）用 `v-html` 渲染标题，
 * 而 core 的 message 与请求路径都可能带外部输入。细节由调用方记日志。
 */
export function pageErrorOf(failure: MxFailure) {
	switch (failure.kind) {
		case 'not-found':
			return { statusCode: 404, statusMessage: 'Not Found', message: msg('error.contentDoesntExist') }
		case 'rate-limited':
			return { statusCode: 503, statusMessage: 'Service Unavailable', message: msg('error.tooManyRequests') }
		case 'unavailable':
			return { statusCode: 503, statusMessage: 'Service Unavailable', message: msg('error.contentServiceTemporarily') }
		case 'unauthorized':
			return { statusCode: 500, statusMessage: 'Internal Server Error', message: msg('error.siteMisconfigurationFront') }
		case 'invalid-request':
			return { statusCode: 500, statusMessage: 'Internal Server Error', message: msg('error.siteErrorInvalid') }
	}
}
