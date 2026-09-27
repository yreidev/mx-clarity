import type { MxClient, MxFetch } from './client'
import { createMxClient } from './client'

/**
 * 浏览器侧的 core 客户端：请求发到同源的 `/api/v3`，由反向代理交给 core。
 * 默认带着读者的 cookie；`anonymous` 时一个 cookie 都不带（匿名发评论、以游客身份核对评论的状态）。
 * 页面、组件、组合函数经 app/composables/useCore.ts 的 `useCoreClient()` 取，不自己建；服务端取数仍用 server/utils/mx.ts。
 * 按「地址 + 内容语言 + 带不带 cookie」各留一个
 */
const clients = new Map<string, MxClient>()

export function browserMxClient(baseURL: string, fetch: MxFetch, lang?: string, anonymous = false) {
	const key = `${baseURL}\n${lang ?? ''}\n${anonymous}`
	let client = clients.get(key)
	if (!client) {
		const credentials = anonymous ? 'omit' : 'include'
		client = createMxClient({
			baseURL,
			fetch: (url, options) => fetch(url, { ...options, credentials }),
			lang,
			timeout: 10_000,
		})
		clients.set(key, client)
	}
	return client
}
