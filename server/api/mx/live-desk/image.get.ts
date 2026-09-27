import { Buffer } from 'node:buffer'

/**
 * 站长「此刻」的图片转发（见 server/utils/live-desk-image.ts）：签名对才取；不跟随重定向、3 秒、512 KB；
 * 只收 png / jpeg / webp / gif / avif（不收 svg：同源的 svg 能带脚本）；按地址缓存 1 天，失败缓存 10 分钟
 */
const MAX_BYTES = 512 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

async function fetchImage(url: string): Promise<{ type: string, data: string } | null> {
	const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000), headers: { accept: 'image/*' } })
	const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
	if (!res.ok || !res.body || !TYPES.has(type))
		return null
	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done)
			break
		size += value.byteLength
		if (size > MAX_BYTES) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	return { type, data: Buffer.concat(chunks).toString('base64') }
}

/** 取不到的地址 10 分钟内不再去取（成功的进 1 天的缓存；失败返回 undefined，不进缓存） */
const failedUntil = new Map<string, number>()
const getCachedImage = defineCachedFunction(
	async (url: string) => {
		if ((failedUntil.get(url) ?? 0) > Date.now())
			return undefined
		const image = await fetchImage(url).catch(() => null)
		if (image)
			return image
		if (failedUntil.size > 1000)
			failedUntil.clear()
		failedUntil.set(url, Date.now() + 10 * 60_000)
		return undefined
	},
	{ name: 'mx-live-desk-image', maxAge: 86_400, getKey: (url: string) => signImageUrl(url) },
)

export default defineEventHandler(async (event) => {
	const { u, s } = getQuery(event)
	const url = typeof u === 'string' ? proxiableImageUrl(u) : undefined
	if (!url || url !== u || typeof s !== 'string' || !verifyImageUrl(url, s))
		throw notFound()
	const image = await getCachedImage(url)
	if (!image)
		throw notFound()
	setHeaders(event, {
		'content-type': image.type,
		'cache-control': 'public, max-age=86400',
		'x-content-type-options': 'nosniff',
		'content-security-policy': 'default-src \'none\'',
	})
	return Buffer.from(image.data, 'base64')
})
