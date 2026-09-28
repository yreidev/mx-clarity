import type { H3Event } from 'h3'
import process from 'node:process'

/**
 * 页面的内容安全策略头，渲染时（server/plugins/security-headers.ts）与页面缓存命中时（server/middleware/5.page-cache.ts）共用：
 * 两边都按「这一次」的 nonce 写，缓存里的页面不复用旧 nonce
 */
const ORIGIN = /^https?:\/\/[\w.-]+(?::\d{1,5})?$/i

/** `NUXT_CSP` 的模式；开发时默认只报不拦（开发工具会 fetch 外站样式表），显式设了就照设的 */
export function pageCspMode() {
	return import.meta.dev && !process.env.NUXT_CSP ? 'report-only' : cspModeOf(useRuntimeConfig().csp)
}

function frameAncestors() {
	return String(useRuntimeConfig().frameAncestors ?? '').split(/\s+/).filter(origin => ORIGIN.test(origin))
}

/** 这个页面该带的策略头：`off` 或没有 nonce 时只有最小策略；`report-only` 时最小策略照拦、完整策略只报 */
export async function pageCspHeadersOf(event: H3Event, nonce: string | undefined): Promise<Record<string, string>> {
	const mode = pageCspMode()
	const ancestors = frameAncestors()
	const minimal = minimalPolicyOf(ancestors)
	if (mode === 'off' || !nonce)
		return { 'content-security-policy': minimal }
	const theme = await getCachedThemeConfig().catch(() => undefined)
	const policy = contentSecurityPolicyOf({ nonce, host: getHeader(event, 'host'), scripts: theme?.scripts ?? [], frameAncestors: ancestors })
	return mode === 'enforce'
		? { 'content-security-policy': policy }
		: { 'content-security-policy': minimal, 'content-security-policy-report-only': policy }
}
