/** core 的 webhook：验签与事件 → 缓存 */
import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { affectsPages, ALL_CACHES, cachesForEvent, verifyWebhookSignature } from '../../app/utils/mx/webhook'

const SECRET = 'test-secret'
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex')

describe('验签', () => {
	const body = JSON.stringify({ id: '1', title: '文章' })

	it('对原始字节算 HMAC-SHA256，对上才过', () => {
		expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true)
		expect(verifyWebhookSignature(Buffer.from(body), sign(body), SECRET)).toBe(true)
	})

	it('密钥不对、正文被改、签名形状不对、没设密钥，一律不过（不抛错）', () => {
		expect(verifyWebhookSignature(body, sign(body, 'other'), SECRET)).toBe(false)
		expect(verifyWebhookSignature(`${body} `, sign(body), SECRET)).toBe(false)
		for (const bad of [undefined, '', 'abc', sign(body).toUpperCase(), `${sign(body)}00`, ['x']])
			expect(verifyWebhookSignature(body, bad, SECRET), String(bad)).toBe(false)
		expect(verifyWebhookSignature(body, sign(body, ''), '')).toBe(false)
	})
})

describe('事件 → 要清的缓存', () => {
	it('内容事件清对应的列表、订阅源、sitemap、统计', () => {
		expect(cachesForEvent('post.update')).toEqual(expect.arrayContaining(['mx-articles', 'mx-feed', 'mx-sitemap', 'mx-stats', 'mx-timeline']))
		expect(cachesForEvent('note.create')).toEqual(expect.arrayContaining(['mx-notes', 'mx-timeline', 'mx-feed']))
		expect(cachesForEvent('page.delete')).toEqual(['mx-page-links', 'mx-sitemap'])
		expect(cachesForEvent('recently.create')).toContain('mx-thinking')
		expect(cachesForEvent('comment.create')).toEqual(['mx-activity'])
	})

	it('站点设置与主题片段按 source 分开清；payload 别的内容不用', () => {
		expect(cachesForEvent('aggregate.update', { source: 'theme', keys: ['theme'] })).toContain('mx-theme-config')
		expect(cachesForEvent('aggregate.update', { source: 'config', keys: ['seo'] })).toContain('mx-site-config')
		expect(cachesForEvent('aggregate.update', { source: 'owner' })).toContain('mx-site-config')
	})

	it('恢复备份清全部；health_check 与不认识的事件什么都不做', () => {
		expect(cachesForEvent('content.refresh')).toEqual(ALL_CACHES)
		expect(cachesForEvent('health_check')).toBeUndefined()
		expect(cachesForEvent('gateway.connect')).toBeUndefined()
		expect(cachesForEvent('')).toBeUndefined()
	})
})

describe('清了哪些缓存才要清整页缓存', () => {
	it('新评论只清「最近动态」，不进页面，整页缓存不动；文章、日记、站点配置这些会进页面的要清', () => {
		expect(affectsPages(cachesForEvent('comment.create')!)).toBe(false)
		expect(affectsPages(['mx-feed', 'mx-sitemap', 'mx-feed-says', 'mx-feed-thinking', 'mx-top'])).toBe(false)
		expect(affectsPages([])).toBe(false)
		for (const event of ['post.update', 'note.create', 'page.update', 'recently.create', 'say.create', 'topic.update', 'category.update', 'translation.update', 'content.refresh'])
			expect(affectsPages(cachesForEvent(event)!), event).toBe(true)
		expect(affectsPages(cachesForEvent('aggregate.update', { source: 'theme' })!)).toBe(true)
		// 不认识的缓存名按会进页面算
		expect(affectsPages(['mx-something-new'])).toBe(true)
	})
})
