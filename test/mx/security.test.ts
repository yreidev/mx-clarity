import type { H3Event } from 'h3'
import { createError } from 'h3'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { redirectTargetOf } from '../../app/utils/mx/theme'
import { assertSameOriginJson, segmentOf } from '../../server/utils/mx-query'

/** 只带请求方法、路径与请求头的假事件；server 里用到的 h3 函数在 Nitro 里是自动导入的全局，这里按同样的签名补上 */
function eventOf(headers: Record<string, string>, method = 'POST', path = '/api/mx/read') {
	return { method, path, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) } as unknown as H3Event
}

beforeAll(() => {
	vi.stubGlobal('getHeader', (event: { headers: Record<string, string> }, name: string) => event.headers[name.toLowerCase()])
	vi.stubGlobal('createError', createError)
	vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
})

describe('拼进 core 路径的参数', () => {
	it('挡住点段及其编码写法：URL 规范里 %2e%2e 就是 ..', () => {
		for (const bad of ['.', '..', '%2e', '%2E%2e', '.%2e', '%2e.', 'a/b', 'a\\b', 'a?b', 'a#b', ''])
			expect(segmentOf(bad), bad).toBeUndefined()
		for (const ok of ['hello-world', 'a.b', '...', '笔记', 'v1.2'])
			expect(segmentOf(ok), ok).toBe(ok)
	})
})

describe('写接口的同源校验', () => {
	const ok = (headers: Record<string, string>) => expect(() => assertSameOriginJson(eventOf(headers))).not.toThrow()
	const forbidden = (headers: Record<string, string>) => expect(() => assertSameOriginJson(eventOf(headers))).toThrow(/请从本站页面提交/)

	it('类型必须正好是 application/json：只判断「包含」的话，不触发预检的表单类型能混过去', () => {
		ok({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' })
		ok({ 'content-type': 'Application/JSON; charset=utf-8', 'sec-fetch-site': 'same-origin' })
		forbidden({ 'content-type': 'application/x-www-form-urlencoded;x=application/json', 'sec-fetch-site': 'same-origin' })
		forbidden({ 'content-type': 'text/plain;application/json', 'sec-fetch-site': 'same-origin' })
		forbidden({ 'sec-fetch-site': 'same-origin' })
	})

	it('带 Sec-Fetch-Site 看它；老浏览器不带时，有 Origin 就要求与 Host 一致', () => {
		forbidden({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })
		forbidden({ 'content-type': 'application/json', 'sec-fetch-site': 'same-site' })
		forbidden({ 'content-type': 'application/json', 'origin': 'https://evil.example', 'host': 'blog.example.com' })
		forbidden({ 'content-type': 'application/json', 'origin': 'null', 'host': 'blog.example.com' })
		ok({ 'content-type': 'application/json', 'origin': 'https://blog.example.com', 'host': 'blog.example.com' })
		// 没有 Origin 的只能是非浏览器客户端，挡不住也不必挡（它们直接调 core 一样）
		ok({ 'content-type': 'application/json' })
	})
})

describe('请求体大小', () => {
	let limit: (event: H3Event) => void
	beforeAll(async () => {
		limit = (await import('../../server/middleware/1.body-limit')).default as unknown as (event: H3Event) => void
	})

	it('/api/mx/ 下的写请求：没有 Content-Length 或超过 64 KB 回 413；读请求与别的路径不管', () => {
		expect(() => limit(eventOf({ 'content-length': '120' }))).not.toThrow()
		expect(() => limit(eventOf({ 'content-length': String(64 * 1024) }))).not.toThrow()
		expect(() => limit(eventOf({ 'content-length': String(64 * 1024 + 1) }))).toThrow(/请求太大/)
		expect(() => limit(eventOf({ 'transfer-encoding': 'chunked' }))).toThrow(/请求太大/)
		expect(() => limit(eventOf({ 'content-length': '-1' }))).toThrow(/请求太大/)
		expect(() => limit(eventOf({}, 'GET'))).not.toThrow()
		expect(() => limit(eventOf({}, 'POST', '/somewhere-else'))).not.toThrow()
	})
})

describe('跳转表的路径规整', () => {
	const redirects = [{ from: '/2021/hello', to: '/posts/tools/hello' }]

	it('末尾斜杠照样认；一长串斜杠不再是平方级耗时；超长路径不查', () => {
		expect(redirectTargetOf(redirects, '/2021/hello///')).toBe('/posts/tools/hello')
		const start = performance.now()
		expect(redirectTargetOf(redirects, `${'/'.repeat(2000)}a`)).toBeUndefined()
		expect(redirectTargetOf(redirects, `/${'/'.repeat(2040)}`)).toBeUndefined()
		expect(performance.now() - start).toBeLessThan(50)
		expect(redirectTargetOf(redirects, `/2021/hello${'/'.repeat(3000)}`)).toBeUndefined()
	})
})
