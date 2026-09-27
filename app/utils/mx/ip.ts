/**
 * SSR 时取访客真实 IP，用于新建发往 core 的 `X-Forwarded-For`。
 *
 * 前提：Nuxt 前面恰好一层我们自己的反向代理。
 * - `x-forwarded-for`：取**最右**一段，即那层代理追加的值。最左段是客户端可控的，
 *   h3 的 `getRequestIP(event, { xForwardedFor: true })` 取的恰恰是最左段，不能用。
 * - `x-real-ip`：只在代理会**覆盖**客户端传来的同名头时才可用。
 */

export type ClientIpHeader = 'x-forwarded-for' | 'x-real-ip'

type Headers = Record<string, string | string[] | undefined>

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/
const IPV6 = /^[\da-f]*:[\da-f:.]*$/i

export function isIp(value: string) {
	return IPV4.test(value) || (IPV6.test(value) && value.includes(':'))
}

function firstHeader(headers: Headers, name: string) {
	const value = headers[name]
	return Array.isArray(value) ? value.join(',') : value
}

export function resolveVisitorIp(headers: Headers, remoteAddress: string | undefined, source: ClientIpHeader = 'x-forwarded-for') {
	const raw = firstHeader(headers, source)
	const candidate = source === 'x-forwarded-for'
		? raw?.split(',').map(s => s.trim()).filter(Boolean).at(-1)
		: raw?.trim()
	if (candidate && isIp(candidate))
		return candidate
	// 没有代理（本地开发）时退到直连地址
	return remoteAddress && isIp(remoteAddress) ? remoteAddress : undefined
}
