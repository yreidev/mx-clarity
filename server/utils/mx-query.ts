/**
 * server 路由的参数校验。参数会进缓存键、拼进发往 core 的路径，先把范围收紧。
 */
import type { H3Event } from 'h3'
import { msg } from '~~/shared/utils/i18n'

/** 页码：1–500 的整数，其余一律按 1 */
export function pageOf(event: H3Event) {
	const page = Number(getQuery(event).page)
	return Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1
}

/**
 * mx 的实体 id 是 Snowflake：与 core 的校验一致，1–19 位、不以 0 开头、不超过 int64。
 * 放宽了的话，core 会对这类 id 回 422，页面成了 500 而不是 404
 */
export function snowflakeOf(value: unknown) {
	return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n ? value : undefined
}

const SEGMENT = /^[^/\\?#]+$/
/** `.` `..` 及其编码写法：URL 规范里 `%2e%2e` 就是 `..`，拼进地址会往上走一级 */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i

/**
 * 会拼进 core 路径的一段（slug 等）：挡住能改写路径的字符与点段。
 * 取路由参数时要 `decode: true`，拼进路径前再 `encodeURIComponent`
 */
export function segmentOf(value: unknown) {
	return typeof value === 'string' && SEGMENT.test(value) && !DOT_SEGMENT.test(value) && value.length <= 200 ? value : undefined
}

export function notFound() {
	return createError({ statusCode: 404, statusMessage: 'Not Found', message: msg('error.contentDoesntExist') })
}

/** 媒体类型的主类型（去掉 `;charset=…` 等参数、转小写） */
function mediaTypeOf(value: string | undefined) {
	return value?.split(';')[0]?.trim().toLowerCase()
}

/**
 * 访客写入的接口（评论、点赞、友链申请……）只收同源的 JSON 请求：
 * 读者身份靠 cookie，别的网站不能借访客的登录状态或 IP 替他提交。
 * 类型必须**正好**是 `application/json`（这会触发预检，跨站发不出来）：只判断「包含」的话，
 * `application/x-www-form-urlencoded;x=application/json` 不触发预检、又能混过去。
 * 浏览器带 Sec-Fetch-Site 就看它；老浏览器不带时，有 Origin 就要求与 Host 一致
 */
export function assertSameOriginJson(event: H3Event) {
	const forbidden = () => createError({ statusCode: 403, statusMessage: 'Forbidden', message: msg('error.pleaseSubmitSites') })
	if (mediaTypeOf(getHeader(event, 'content-type')) !== 'application/json')
		throw forbidden()
	const site = getHeader(event, 'sec-fetch-site')
	if (site) {
		if (site !== 'same-origin')
			throw forbidden()
		return
	}
	const origin = getHeader(event, 'origin')
	if (!origin)
		return
	try {
		if (new URL(origin).host !== getHeader(event, 'host'))
			throw forbidden()
	}
	catch {
		throw forbidden()
	}
}
