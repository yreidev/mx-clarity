/**
 * 匿名访客的整页缓存：命中就直接发缓存的页面（换上新的 CSP nonce 与策略头），没命中就记下键，
 * 渲染完由 server/plugins/page-cache.ts 存。规则见 server/utils/page-cache.ts。
 * 排在最后（文件名的数字定顺序，Nitro 按文件名排）：旧链接跳转、按浏览器语言跳转都先于它，跳转因人而异，不进缓存；
 * 缓存命中时也照样先走跳转，站长新加的跳转不用等缓存过期
 */
export default defineEventHandler((event) => {
	// 渲染期间 core 失败过的页面不存（server/plugins/page-cache.ts），这里记下开始的时刻
	event.context.pageRenderStartedAt = Date.now()
	const ttl = Number(useRuntimeConfig(event).pageCache) || 0
	if (import.meta.dev || ttl <= 0)
		return
	const url = getRequestURL(event)
	const key = pageCacheKeyOf({
		method: event.method,
		path: url.pathname,
		search: url.search,
		host: getHeader(event, 'host'),
		accept: getHeader(event, 'accept'),
		cookie: getHeader(event, 'cookie'),
	})
	if (!key)
		return
	const now = Date.now()
	const page = pageStore.get(key, now, ttl * 1000)
	if (!page) {
		event.context.pageCacheKey = key
		setResponseHeader(event, 'x-page-cache', 'MISS')
		return
	}
	return (async () => {
		const nonce = pageCspMode() === 'off' ? undefined : createNonce()
		for (const [name, value] of Object.entries(page.headers))
			setResponseHeader(event, name, value)
		for (const [name, value] of Object.entries(await pageCspHeadersOf(event, nonce)))
			setResponseHeader(event, name, value)
		setResponseHeader(event, 'x-page-cache', 'HIT')
		setResponseHeader(event, 'age', Math.floor((now - page.storedAt) / 1000))
		if (event.method === 'HEAD')
			return ''
		return nonce ? page.body.replaceAll(NONCE_PLACEHOLDER, nonce) : page.body
	})()
})
