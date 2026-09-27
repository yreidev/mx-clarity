/**
 * 转给 core 的 cookie 只留 Better Auth 的会话。纯模块。
 *
 * 站点域名下还可能有别的 cookie（主题偏好、统计……），它们与 core 无关，不该发过去。
 */

/** Better Auth 的 cookie 前缀是 `better-auth.`；HTTPS 下另加 `__Secure-`（本地实例实测为后者） */
const AUTH_COOKIE = /^(?:__Secure-)?better-auth\.[\w.-]+$/

export function pickAuthCookies(header: string | string[] | undefined) {
	const raw = Array.isArray(header) ? header.join('; ') : header
	if (!raw)
		return undefined
	const kept = raw.split(';')
		.map(part => part.trim())
		.filter((part) => {
			const name = part.slice(0, part.indexOf('='))
			return part.includes('=') && AUTH_COOKIE.test(name)
		})
	return kept.length ? kept.join('; ') : undefined
}
