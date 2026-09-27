import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 站长「此刻」的图片（应用图标、封面）经主题服务器转发：读者的浏览器不连第三方。
 * 映射时把原地址换成 `/api/mx/live-desk/image?u=<原地址>&s=<签名>`；签名用进程启动时随机生成的密钥，
 * 只有 core 状态里出现过的地址签得出来，这个接口不是开放代理（重启后旧签名失效，页面重新取一次就好）
 */
const KEY = randomBytes(32)

export function signImageUrl(url: string) {
	return createHmac('sha256', KEY).update(url).digest('base64url').slice(0, 32)
}

export function verifyImageUrl(url: string, signature: string) {
	const expected = Buffer.from(signImageUrl(url))
	const given = Buffer.from(signature)
	return expected.length === given.length && timingSafeEqual(expected, given)
}

/** 能转发的地址：https、没有用户名、主机不是 IP 字面量或 localhost、2 KB 以内 */
export function proxiableImageUrl(value: string) {
	if (value.length > 2048)
		return undefined
	try {
		const url = new URL(value)
		const host = url.hostname.toLowerCase()
		if (url.protocol !== 'https:' || url.username || url.password || url.port)
			return undefined
		if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('['))
			return undefined
		return url.href
	}
	catch {
		return undefined
	}
}

/** 第三方图片地址 → 本站的转发地址；不能转发的返回 undefined（就不显示图） */
export function liveDeskImageUrlOf(value: string) {
	const url = proxiableImageUrl(value)
	return url ? `/api/mx/live-desk/image?${new URLSearchParams({ u: url, s: signImageUrl(url) })}` : undefined
}
