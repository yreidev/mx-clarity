import { redirectTargetOf } from '~~/app/utils/mx/theme'

/** 这些路径不可能是旧链接，不查跳转表 */
const SKIP = ['/_nuxt/', '/_ipx/', '/__', '/api/']

/** 旧链接跳转：主题配置里的 `redirects`，308（保留请求方法） */
export default defineEventHandler(async (event) => {
	if (event.method !== 'GET' && event.method !== 'HEAD')
		return
	const pathname = event.path.split('?')[0] ?? '/'
	if (pathname === '/' || SKIP.some(prefix => pathname.startsWith(prefix)))
		return
	const theme = await getCachedThemeConfig().catch(() => undefined)
	const target = theme?.redirects.length ? redirectTargetOf(theme.redirects, pathname) : undefined
	if (target)
		return sendRedirect(event, target, 308)
})
