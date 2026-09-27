/**
 * 页面渲染完之后存进整页缓存（只存 server/middleware/5.page-cache.ts 记了键的请求）：
 * 本次的 CSP nonce 换成占位符，响应头只留能共用的部分。
 * - 页面自己标了 `private` / `no-store`（付费文章、草稿预览，用 `useResponseHeader` 设在请求上，渲染器的响应头里没有）的不存；
 * - 降级拼出来的页面（渲染时有取数报错，或这段时间 core 失败过）不存，并标成 `no-store`，前面的 CDN 也别存
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('render:response', (response, { event }) => {
		if (!String(response.headers?.['content-type'] ?? '').startsWith('text/html'))
			return
		const startedAt = event.context.pageRenderStartedAt as number | undefined
		if (event.context.pageDegraded === true || (startedAt !== undefined && coreFailedSince(startedAt))) {
			(response.headers ??= {})['cache-control'] = 'no-store'
			return
		}
		const key = event.context.pageCacheKey as string | undefined
		if (!key || typeof response.body !== 'string')
			return
		const headers = storableHeadersOf(response.headers)
		if (!isStorablePage(response.statusCode, withOwnCacheControl(headers, getResponseHeader(event, 'cache-control'))))
			return
		const nonce = event.context.cspNonce as string | undefined
		const body = nonce ? response.body.replaceAll(nonce, NONCE_PLACEHOLDER) : response.body
		pageStore.set(key, { body, headers, storedAt: Date.now() })
	})
})
