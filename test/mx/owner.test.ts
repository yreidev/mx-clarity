/**
 * 读者屏蔽与站长的前台操作：请求的路径与请求体、错误的固定文案、输入校验
 */
import { describe, expect, it } from 'vitest'
import { blockCommentAuthor, blockErrorOf, ownerEditComment, pinComment } from '../../app/utils/mx/comments'
import { parseOwnerStatusInput } from '../../app/utils/mx/companion'
import { adminEditUrlOf, adminHomeUrlOf } from '../../shared/utils/admin'
import { clientWith, jsonResponse } from './helpers'

describe('屏蔽此人', () => {
	it('转 core 的 report-and-block', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { ok: true } }))
		await blockCommentAuthor(client, '42')
		expect(requests[0]!.method).toBe('POST')
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/comments/42/report-and-block')
	})

	it('错误只给固定文案', () => {
		expect(blockErrorOf({ kind: 'invalid-request', status: 400, code: 'INVALID_PARAMETER' } as never)).toEqual({ statusCode: 400, message: '这个人不能屏蔽' })
		expect(blockErrorOf({ kind: 'unauthorized', status: 401, code: 'AUTH_NOT_LOGGED_IN' } as never).statusCode).toBe(401)
		expect(blockErrorOf({ kind: 'not-found', status: 404 } as never).statusCode).toBe(404)
		expect(blockErrorOf({ kind: 'unavailable', status: 503 } as never)).toEqual({ statusCode: 503, message: '屏蔽没有成功，请稍后再试' })
	})
})

describe('站长', () => {
	it('置顶：PATCH /comments/:id 带 { pin }；请求体只认布尔值', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: {} }))
		await pinComment(client, '42', false)
		expect(requests[0]!.method).toBe('PATCH')
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/comments/42')
		expect(await requests[0]!.json()).toEqual({ pin: false })
	})

	it('改评论：转 PATCH /comments/edit/:id，正文照评论的白名单渲染', async () => {
		const { client, requests } = clientWith(() => new Response(null, { status: 204 }))
		const result = await ownerEditComment(client, '42', '**改过**', { now: Date.parse('2026-09-25T00:00:00Z') })
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/comments/edit/42')
		expect(JSON.stringify(result.body)).toContain('"type":"strong"')
		expect(result.editedAt).toBe('2026-09-25T00:00:00.000Z')
	})

	it('站长状态的输入：表情与一句话必填、限长，有效期 60 秒到 30 天的整数秒', () => {
		expect(parseOwnerStatusInput({ emoji: '☕', desc: ' 写代码 ', ttl: 3600 })).toEqual({ emoji: '☕', desc: '写代码', ttl: 3600 })
		expect(parseOwnerStatusInput({ emoji: '☕', desc: 'x'.repeat(80), ttl: 60 })).toMatchObject({ desc: 'x'.repeat(60) })
		for (const bad of [{ desc: 'x', ttl: 60 }, { emoji: '☕', ttl: 60 }, { emoji: '☕', desc: 'x', ttl: 59 }, { emoji: '☕', desc: 'x', ttl: 30 * 86_400 + 1 }, { emoji: '☕', desc: 'x', ttl: 1.5 }, null])
			expect(typeof parseOwnerStatusInput(bad), JSON.stringify(bad)).toBe('string')
	})

	it('控制台地址：主题配置的 adminUrl，没填用站点地址加 /proxy/qaqdmin；不是 http(s) 不给', () => {
		expect(adminHomeUrlOf({ adminUrl: 'https://admin.example.test/', webUrl: 'https://blog.example.test' })).toBe('https://admin.example.test')
		expect(adminHomeUrlOf({ webUrl: 'https://blog.example.test/' })).toBe('https://blog.example.test/proxy/qaqdmin')
		expect(adminHomeUrlOf({ adminUrl: 'javascript:alert(1)' })).toBeUndefined()
		expect(adminEditUrlOf({ webUrl: 'https://blog.example.test', path: '/notes/3', id: '9' })).toBe('https://blog.example.test/proxy/qaqdmin/#/notes/edit?id=9')
	})
})
