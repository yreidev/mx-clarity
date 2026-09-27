import { pickAuthCookies } from '~~/app/utils/mx/cookie'

/**
 * 页面（HTML）的安全响应头。全站通用的几个（防嵌套、nosniff、Referrer-Policy、Permissions-Policy）在 nuxt.config 的 routeRules 里；
 * 这里只处理页面：
 * - 内容安全策略（server/utils/csp.ts、page-security.ts）：渲染时给 Nuxt 自己的脚本加上本次请求的 nonce，响应头里写对应的策略。
 *   `NUXT_CSP` 可改成 `report-only`（只报不拦）或 `off`（只留防嵌套、禁 object、锁 base 这条最小的）。
 *   页面缓存命中时不经过这里，由 server/middleware/5.page-cache.ts 换上新 nonce、照同样的规则写策略头
 * - 去掉 `x-powered-by: Nuxt`（渲染器在 routeRules 之后才写它，只能在这里删）
 * - 请求带着登录 cookie（读者、会员，或单域名下登录了 admin 的站长）时，页面因人而异（草稿、全文、评论框里的身份），
 *   标成 `private, no-store`，不让前面的 CDN 之类的共享缓存存下
 */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('render:html', (html, { event }) => {
		if (pageCspMode() === 'off')
			return
		const nonce = createNonce()
		event.context.cspNonce = nonce
		// 只给 Nuxt 与模块生成的部分加 nonce；正文（html.body）不加
		html.head = html.head.map(chunk => withNonce(chunk, nonce))
		html.bodyPrepend = html.bodyPrepend.map(chunk => withNonce(chunk, nonce))
		html.bodyAppend = html.bodyAppend.map(chunk => withNonce(chunk, nonce))
	})

	nitroApp.hooks.hook('render:response', async (response, { event }) => {
		const headers = response.headers ?? (response.headers = {})
		delete headers['x-powered-by']
		removeResponseHeader(event, 'x-powered-by')
		if (!String(headers['content-type'] ?? '').startsWith('text/html'))
			return
		if (pickAuthCookies(getHeader(event, 'cookie')))
			headers['cache-control'] = 'private, no-store'
		if (headers['content-security-policy'])
			return
		Object.assign(headers, await pageCspHeadersOf(event, event.context.cspNonce as string | undefined))
	})
})
