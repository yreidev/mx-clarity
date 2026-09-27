import { randomUUID } from 'node:crypto'
import { pickAuthCookies } from '~~/app/utils/mx/cookie'

/**
 * 匿名访客的整页缓存：同一个页面 10 分钟内只渲染一次（`NUXT_PAGE_CACHE`，秒，0 关闭），webhook 一来整个清掉。
 * 存在进程内存里，按条数与总大小淘汰最久没用的。
 * - 带登录 cookie 的请求不读也不存：付费正文、会员状态、评论框里的身份因人而异；
 * - 只认会影响渲染的查询参数，带了别的（支付回跳、`?peek-to=`、随手加的）就不走缓存，免得被随机参数塞满；
 * - 搜索页与草稿预览不缓存；
 * - 页面里的 CSP nonce 换成占位符再存，每次发出时换成新的，nonce 不复用
 */

/** 缓存的页面里 nonce 的占位符：每个进程随机一个，正文里写不出来 */
export const NONCE_PLACEHOLDER = `mx-nonce-${randomUUID()}`

const QUERY_KEYS = new Set(['page', 'lang', 'type', 'memory', 'view'])
const INTERNAL = /^\/(?:api|_nuxt|_ipx)(?:\/|$)|^\/__/
const UNCACHED = /^\/(?:[a-z]{2}\/)?(?:search|preview)(?:\/|$)/
const MAX_KEY = 512

export interface PageRequest {
	method: string
	/** 网址的路径部分（未解码） */
	path: string
	/** `?a=1` 或空串 */
	search: string
	host?: string
	accept?: string
	cookie?: string
}

/** 这个请求能不能走缓存：能就给缓存键（Host + 路径 + 排好序的查询参数），不能就是 undefined */
export function pageCacheKeyOf(request: PageRequest) {
	if (request.method !== 'GET' && request.method !== 'HEAD')
		return undefined
	if (!(request.accept ?? '').includes('text/html'))
		return undefined
	if (INTERNAL.test(request.path) || /\.[\w-]+$/.test(request.path) || UNCACHED.test(request.path))
		return undefined
	if (pickAuthCookies(request.cookie))
		return undefined
	const kept: [string, string][] = []
	for (const [name, value] of new URLSearchParams(request.search)) {
		if (!QUERY_KEYS.has(name))
			return undefined
		kept.push([name, value])
	}
	kept.sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y))
	const query = new URLSearchParams(kept).toString()
	const key = `${request.host ?? ''}${request.path}${query ? `?${query}` : ''}`
	return key.length <= MAX_KEY ? key : undefined
}

export interface CachedPage {
	body: string
	headers: Record<string, string>
	storedAt: number
}

/** 不存的响应头：因人而异的、每次都要重写的 */
const VOLATILE_HEADERS = new Set(['set-cookie', 'content-security-policy', 'content-security-policy-report-only', 'x-powered-by', 'date', 'age', 'x-page-cache', 'content-length', 'transfer-encoding', 'connection'])

/** 渲染器给的响应头里能跟着页面一起存的部分（名字统一小写） */
export function storableHeadersOf(headers: Record<string, unknown> | undefined) {
	const out: Record<string, string> = {}
	for (const [name, value] of Object.entries(headers ?? {})) {
		const key = name.toLowerCase()
		if (value === undefined || value === null || VOLATILE_HEADERS.has(key))
			continue
		out[key] = Array.isArray(value) ? value.join(', ') : String(value)
	}
	return out
}

/**
 * 合上页面自己设的 `cache-control`：页面用 `useResponseHeader` 设在请求上（付费文章的 `private, no-store`），
 * 渲染器交给 `render:response` 的响应头里没有它，只看后者会把因人而异的页面存下来
 */
export function withOwnCacheControl(headers: Record<string, string>, own: unknown) {
	const value = Array.isArray(own) ? own.join(', ') : own === undefined || own === null ? '' : String(own)
	return value ? { ...headers, 'cache-control': headers['cache-control'] ? `${headers['cache-control']}, ${value}` : value } : headers
}

/** 渲染结果能不能存：200、是 HTML、没被标成 private / no-store */
export function isStorablePage(status: number | undefined, headers: Record<string, string>) {
	return (status ?? 200) === 200
		&& (headers['content-type'] ?? '').startsWith('text/html')
		&& !/\b(?:private|no-store)\b/i.test(headers['cache-control'] ?? '')
}

export function createPageStore({ maxEntries = 400, maxBytes = 64 * 1024 * 1024 } = {}) {
	const entries = new Map<string, CachedPage>()
	let bytes = 0
	const sizeOf = (page: CachedPage) => page.body.length
	const remove = (key: string) => {
		const page = entries.get(key)
		if (!page)
			return
		entries.delete(key)
		bytes -= sizeOf(page)
	}
	return {
		/** 取一页：过期的顺手删掉；取到的挪到最近用过 */
		get(key: string, now: number, ttlMs: number) {
			const page = entries.get(key)
			if (!page)
				return undefined
			if (now - page.storedAt >= ttlMs) {
				remove(key)
				return undefined
			}
			entries.delete(key)
			entries.set(key, page)
			return page
		},
		set(key: string, page: CachedPage) {
			remove(key)
			if (sizeOf(page) > maxBytes)
				return
			entries.set(key, page)
			bytes += sizeOf(page)
			// Map 按放进去的先后排，最前面的就是最久没用的
			for (const oldest of entries.keys()) {
				if (entries.size <= maxEntries && bytes <= maxBytes)
					break
				remove(oldest)
			}
		},
		clear() {
			entries.clear()
			bytes = 0
		},
		get size() {
			return entries.size
		},
	}
}

/** 这个进程的页面缓存 */
export const pageStore = createPageStore()

/** webhook 清缓存时一起清（server/utils/cache-purge.ts） */
export function clearPageCache() {
	pageStore.clear()
}
