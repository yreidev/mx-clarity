import type { FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EDGE_POST_TITLE, startFakeCore } from './fake-core'
import { freePort, startTheme } from './harness'

/** 主题配置：时区与进程的 TZ（harness 里是 UTC）不同，才看得出取的是配置 */
const THEME = { timeZone: 'Asia/Shanghai' }

let core: FakeCore
let theme: ThemeServer
/** core 的阅读上报（`POST /ack`）这会儿回什么 */
let ackStatus = 204

beforeAll(async () => {
	core = await startFakeCore({
		theme: THEME,
		handle: request => request.method === 'POST' && request.path.startsWith('/ack')
			? (ackStatus === 204 ? { status: 204 } : { status: ackStatus, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } })
			: undefined,
	})
	theme = await startTheme(core.apiUrl)
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

const get = (path: string, init?: RequestInit) => fetch(`${theme.url}${path}`, init)

/** 原样发出路径：fetch 会按 URL 规范先把 `%2e%2e` 当成 `..` 规范化掉，测不到服务端 */
function rawStatus(path: string) {
	return new Promise<number>((resolve, reject) => {
		const req = request(`${theme.url}/`, { path }, (res) => {
			res.resume()
			resolve(res.statusCode ?? 0)
		})
		req.on('error', reject)
		req.end()
	})
}

/** 缓存热了之后，渲染一次页面打到 core 的请求 */
async function coreRequestsFor(path: string) {
	await get(path).then(res => res.text())
	await get(path).then(res => res.text())
	core.requests.length = 0
	await get(path).then(res => res.text())
	return core.requests.map(request => request.path.split('?')[0])
}

// 上限是首页 3、详情 2、列表 2；这里按现在的实际数守着（站点配置、文章列表、主题配置都在缓存里），多出来就是退化
describe('每页请求预算', () => {
	it.each([
		['首页', '/', 0],
		['文章详情', '/posts/tech/mx-syntax-sample', 1],
		['日记详情', '/notes/2', 1],
		['列表页', '/posts/tech', 0],
		['归档', '/archive', 0],
	])('%s 缓存热了之后打到 core 的请求不超过 %s 个', async (_, path, budget) => {
		const requests = await coreRequestsFor(path as string)
		expect(requests.length, requests.join(' ')).toBeLessThanOrEqual(budget as number)
	})
})

describe('转发访客 IP', () => {
	it('core 收到的是 X-Forwarded-For 的最右段，且只有这一段', async () => {
		core.requests.length = 0
		await get('/posts/tech/mx-syntax-sample', { headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7' } }).then(res => res.text())
		const detail = core.requests.find(request => request.path.startsWith('/posts/tech/mx-syntax-sample'))
		expect(detail?.headers['x-forwarded-for']).toBe('198.51.100.7')
	})
})

describe('页脚', () => {
	it('带着主题本身与上游 blog-v3 的链接', async () => {
		const html = await get('/').then(res => res.text())
		expect(html).toContain('href="https://github.com/L33Z22L11/blog-v3"')
		expect(html).toContain('基于 Clarity')
	})
})

describe('站点时区', () => {
	it('主题配置的时区优先于进程的 TZ：UTC 2022-12-31 20:00 的文章归到 2023 年', async () => {
		const html = await get('/archive').then(res => res.text())
		const at = html.indexOf(EDGE_POST_TITLE)
		expect(at).toBeGreaterThan(0)
		const years = [...html.slice(0, at).matchAll(/class="archive-year"[^>]*>\s*(\d{4})/g)].map(match => match[1])
		expect(years.at(-1)).toBe('2023')
	})
})

describe('安全响应头与写接口', () => {
	it('页面有安全头与 CSP、没有 x-powered-by；接口只有安全头、没有 CSP', async () => {
		const page = await get('/posts/tech/mx-syntax-sample')
		expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN')
		expect(page.headers.get('x-content-type-options')).toBe('nosniff')
		expect(page.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
		expect(page.headers.get('content-security-policy')).toMatch(/script-src 'nonce-[^']+' 'strict-dynamic'/)
		expect(page.headers.get('x-powered-by')).toBeNull()
		expect(page.headers.get('cache-control')).toBeNull()
		const api = await get('/api/mx/site')
		expect(api.headers.get('x-frame-options')).toBe('SAMEORIGIN')
		expect(api.headers.get('content-security-policy')).toBeNull()
	})

	it('每次请求的 nonce 都不同，页面里的脚本都带着它', async () => {
		const [a, b] = await Promise.all([get('/'), get('/')])
		const nonceOf = (res: Response) => res.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1]
		expect(nonceOf(a)).not.toBe(nonceOf(b))
		const html = await a.text()
		const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(match => match[0])
		expect(scripts.length).toBeGreaterThan(0)
		expect(scripts.filter(tag => !tag.includes(`nonce="${nonceOf(a)}"`))).toEqual([])
	})

	it('带登录 cookie 的页面与文章接口不许共享缓存', async () => {
		const cookie = { cookie: 'better-auth.session_token=abc' }
		expect((await get('/posts/tech/mx-syntax-sample', { headers: cookie })).headers.get('cache-control')).toBe('private, no-store')
		expect((await get('/api/mx/posts/tech/mx-syntax-sample', { headers: cookie })).headers.get('cache-control')).toBe('private, no-store')
		expect((await get('/posts/tech/mx-syntax-sample', { headers: { cookie: 'theme=dark' } })).headers.get('cache-control')).toBeNull()
	})

	it('阅读上报：转给 core 失败了不算报过，同一访客重报能计上；计上之后 30 分钟内不再转', async () => {
		const report = () => get('/api/mx/read', {
			method: 'POST',
			body: JSON.stringify({ kind: 'post', id: '183590000000000077' }),
			headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
		})
		const acks = () => core.requests.filter(request => request.method === 'POST' && request.path.startsWith('/ack')).length
		ackStatus = 503
		expect((await report()).ok).toBe(false)
		ackStatus = 204
		const beforeRetry = acks()
		expect(await (await report()).json()).toEqual({ counted: true })
		expect(acks()).toBe(beforeRetry + 1)
		expect(await (await report()).json()).toEqual({ counted: false })
		expect(acks()).toBe(beforeRetry + 1)
	})

	it('写接口：超过 64 KB 或分块传输回 413；类型不是正好 application/json、跨站回 403', async () => {
		const post = (body: BodyInit, headers: Record<string, string>) => get('/api/mx/read', { method: 'POST', body, headers: { 'sec-fetch-site': 'same-origin', ...headers } }).then(res => res.status)
		expect(await post(JSON.stringify({ pad: 'x'.repeat(70_000) }), { 'content-type': 'application/json' })).toBe(413)
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{}'))
				controller.close()
			},
		})
		expect(await get('/api/mx/read', { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' } } as RequestInit).then(res => res.status)).toBe(413)
		expect(await post('kind=post&id=1', { 'content-type': 'application/x-www-form-urlencoded;x=application/json' })).toBe(403)
		expect(await post('{}', { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).toBe(403)
	})

	it('浏览器要 HTML 时，服务端抛的错误（接口外的 404）回主题的错误页，不挂住', async () => {
		const res = await get('/skills/nope/SKILL.md', { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10_000) })
		expect(res.status).toBe(404)
		const html = await res.text()
		expect(html).toContain('class="app-error"')
		expect(html).toContain('id="blog-sidebar"')
	})

	it('路径里的点段拼不进 core 的地址', async () => {
		core.requests.length = 0
		for (const path of ['/api/mx/pages/%2e%2e', '/api/mx/pages/.', '/api/mx/posts/%2e/mx-syntax-sample', '/api/mx/posts/tech/%2E%2e'])
			expect(await rawStatus(path), path).toBe(404)
		expect(core.requests.filter(request => /^\/(?:pages|posts)(?:\/|$)(?!tech\/mx)/.test(request.path.split('?')[0]!))).toEqual([])
	})
})

describe('可观测性', () => {
	it('health：core 通时 200', async () => {
		const res = await get('/api/mx/health')
		expect(res.status).toBe(200)
		expect(await res.json()).toEqual({ status: 'ok' })
		expect(res.headers.get('cache-control')).toBe('no-store')
	})

	it('启动时有一条 mx.start，带主题与 api-client 的版本', () => {
		const start = theme.logs.map(line => (line.startsWith('{') ? JSON.parse(line) : undefined)).find(line => line?.event === 'mx.start')
		expect(start).toMatchObject({ level: 'info', theme: expect.any(String), apiClient: expect.stringMatching(/^\d+\.\d+\.\d+/) })
	})
})

describe('core 连不上', () => {
	let down: ThemeServer

	beforeAll(async () => {
		down = await startTheme(`http://127.0.0.1:${await freePort()}/api/v3`)
	})

	afterAll(async () => {
		await down?.close()
	})

	it('首页照样渲染兜底的站名，不白屏；health 是 503；日志里有结构化的降级记录', async () => {
		const res = await fetch(`${down.url}/`)
		expect(res.status).toBe(200)
		expect(await res.text()).toContain('我的博客')
		const health = await fetch(`${down.url}/api/mx/health`)
		expect(health.status).toBe(503)
		expect(await health.json()).toEqual({ status: 'degraded', core: 'down' })
		const degraded = down.logs.filter(line => line.includes('"mx.degraded"')).map(line => JSON.parse(line))
		expect(degraded.length).toBeGreaterThan(0)
		expect(degraded[0]).toMatchObject({ level: 'warn', kind: 'unavailable', code: 'NETWORK_ERROR' })
	})
})
