/**
 * core 的 webhook：验签与「事件 → 要清的缓存」。纯模块，由 server 路由调用。
 *
 * core 对 `JSON.stringify(payload)` 算 HMAC-SHA256，放在 `X-Webhook-Signature256`（小写 hex）；事件名在 `X-Webhook-Event`。
 * 时间戳不在签名里，挡不住重放：所以 payload 的内容一概不用，只用事件名决定清哪些缓存，被重放也只是多清几次
 */
import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

const HEX_SHA256 = /^[0-9a-f]{64}$/

/** 对请求体的原始字节验签：先看形状，再按等长比较 */
export function verifyWebhookSignature(body: Buffer | string, signature: unknown, secret: string) {
	if (!secret || typeof signature !== 'string' || !HEX_SHA256.test(signature))
		return false
	const expected = createHmac('sha256', secret).update(body).digest()
	const received = Buffer.from(signature, 'hex')
	return received.length === expected.length && timingSafeEqual(received, expected)
}

const POSTS = ['mx-articles', 'mx-feed', 'mx-sitemap', 'mx-stats', 'mx-timeline', 'mx-activity']
const NOTES = ['mx-notes', 'mx-timeline', 'mx-feed', 'mx-sitemap', 'mx-stats', 'mx-activity']
const SAYS = ['mx-says', 'mx-says-all', 'mx-feed-says']
const THINKING = ['mx-thinking', 'mx-top', 'mx-feed-thinking']

/** 不进服务端渲染页面的缓存：订阅源、站点地图，以及只在浏览器里取的「最近动态」（最新评论与碎碎念） */
const PAGELESS_CACHES = new Set(['mx-activity', 'mx-top', 'mx-feed', 'mx-feed-says', 'mx-feed-thinking', 'mx-sitemap'])

/**
 * 清了这些缓存，整页缓存要不要跟着清：有一项会进页面就要。
 * 新评论只清「最近动态」，页面不用重渲染；不认识的名字按会进页面算
 */
export function affectsPages(names: readonly string[]) {
	return names.some(name => !PAGELESS_CACHES.has(name))
}

/** 全部缓存（`content.refresh`：core 恢复了备份） */
export const ALL_CACHES = ['mx-site-config', 'mx-articles', 'mx-timeline', 'mx-page-links', 'mx-theme-config', 'mx-notes', 'mx-says', 'mx-says-all', 'mx-thinking', 'mx-top', 'mx-activity', 'mx-feed', 'mx-feed-says', 'mx-feed-thinking', 'mx-sitemap', 'mx-stats', 'mx-projects', 'mx-links', 'mx-topics', 'mx-membership-offers']

/**
 * 事件 → 要清的缓存名。`health_check` 与不认识的事件返回 `undefined`（回 200、什么都不做）。
 * core 14.13.0 对说说、专栏、友链、项目的增改删不发事件，那几个缓存只能等过期
 */
export function cachesForEvent(event: string, payload?: unknown): string[] | undefined {
	const [kind] = event.split('.')
	switch (kind) {
		case 'post':
			return POSTS
		case 'note':
			return NOTES
		case 'page':
			return ['mx-page-links', 'mx-sitemap']
		case 'recently':
			return THINKING
		case 'say':
			return SAYS
		case 'topic':
			return ['mx-topics', 'mx-sitemap']
		case 'category':
			return ['mx-articles', 'mx-sitemap', 'mx-feed']
		case 'comment':
			return ['mx-activity']
		case 'translation':
			return ['mx-articles', 'mx-notes', 'mx-timeline']
		case 'content':
			return event === 'content.refresh' ? ALL_CACHES : undefined
		case 'aggregate': {
			if (event !== 'aggregate.update')
				return undefined
			// 只看 source 决定清哪组；payload 别的内容一概不用
			const source = (payload as { source?: unknown } | undefined)?.source
			if (source === 'theme')
				return ['mx-theme-config', 'mx-articles', 'mx-feed']
			return ['mx-site-config', 'mx-feed', 'mx-sitemap']
		}
	}
	return undefined
}
