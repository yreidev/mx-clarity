/**
 * 服务端渲染时有取数失败（页面里是错误框或兜底值）：记在这次请求上，整页缓存不存这一页（server/plugins/page-cache.ts）。
 * 失败的取数都在 `payload._errors` 里，不用每个页面自己报
 */
export default defineNuxtPlugin((nuxtApp) => {
	nuxtApp.hook('app:rendered', () => {
		const event = nuxtApp.ssrContext?.event
		if (event && Object.values(nuxtApp.payload._errors ?? {}).some(Boolean))
			event.context.pageDegraded = true
	})
})
