/**
 * `useRenderNow` 的「现在」：首屏用服务端渲染时的值（水合前后一致），水合完成后每分钟往前走一格，
 * 站内跳转后也同步一次。「剩 X 天」「限时公开」这类文字因此会跟着时间变，到期时页面能自己刷新（`useRefreshWhenPassed`）
 */
export default defineNuxtPlugin((nuxtApp) => {
	const now = useRenderNow()
	const tick = () => {
		now.value = Date.now()
	}
	let started = false
	nuxtApp.hook('app:suspense:resolve', () => {
		if (started)
			return
		started = true
		tick()
		setInterval(tick, 60_000)
	})
	nuxtApp.hook('page:finish', tick)
})
