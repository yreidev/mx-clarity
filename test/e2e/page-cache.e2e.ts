/**
 * 匿名访客的整页缓存：第二次起直接发缓存；每次发出都换新 nonce 并与策略头对上；
 * 带登录 cookie、带了别的查询参数、搜索页、出错的页面不走缓存；webhook 一来整个作废；按浏览器语言跳转照旧先于缓存；
 * 页面自己标了不许共享缓存的（付费文章）、core 挂了时拼出来的降级页不存；新评论不清整页缓存
 */
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { startTheme } from './harness'

const SECRET = 'e2e-page-cache-secret'

let core: FakeCore
let theme: ThemeServer
/** 限时公开中的付费文章：游客看得到全文，页面因人而异 */
const PREMIUM = '/posts/tools/sample-list-code'
/** 打开时 core 对所有 HTTP 请求回 503 */
let coreDown = false

function handle(request: CoreRequest): CoreReply | undefined {
	if (coreDown)
		return { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } } }
	if (request.path.split('?')[0] === PREMIUM)
		return { body: JSON.parse(readFileSync(new URL('../fixtures/mx/post-premium-free-window.json', import.meta.url), 'utf8')) }
	return undefined
}

beforeAll(async () => {
	core = await startFakeCore({ theme: { i18n: { languages: ['en'] } }, handle })
	theme = await startTheme(core.apiUrl, { NUXT_PAGE_CACHE: '600', NUXT_MX_WEBHOOK_SECRET: SECRET })
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

function page(path: string, headers: Record<string, string> = {}, method = 'GET') {
	return fetch(`${theme.url}${path}`, {
		method,
		redirect: 'manual',
		headers: { 'accept': 'text/html', 'accept-language': 'zh-CN', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)', ...headers },
	})
}

/** 策略头里的 nonce 与页面里所有 nonce 属性 */
async function noncesOf(res: Response) {
	const header = res.headers.get('content-security-policy') ?? ''
	const body = await res.text()
	return { header: /'nonce-([^']+)'/.exec(header)?.[1], inBody: [...new Set([...body.matchAll(/\snonce="([^"]+)"/g)].map(match => match[1]))], body }
}

async function webhook(event: string) {
	const body = JSON.stringify({ id: '1' })
	const signature = createHmac('sha256', SECRET).update(body).digest('hex')
	return fetch(`${theme.url}/api/mx/webhook`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-webhook-event': event, 'x-webhook-signature256': signature } })
}

describe('整页缓存', () => {
	it('第二次起命中；每次发出的 nonce 都是新的，与策略头一致，占位符不外露', async () => {
		const first = await page('/archive')
		expect(first.headers.get('x-page-cache')).toBe('MISS')
		const a = await noncesOf(first)
		const second = await page('/archive')
		expect(second.headers.get('x-page-cache')).toBe('HIT')
		expect(Number(second.headers.get('age'))).toBeGreaterThanOrEqual(0)
		const b = await noncesOf(second)
		const third = await noncesOf(await page('/archive'))
		for (const each of [a, b, third]) {
			expect(each.header).toBeTruthy()
			expect(each.inBody).toEqual([each.header])
			expect(each.body).not.toContain('mx-nonce-')
		}
		expect(new Set([a.header, b.header, third.header]).size).toBe(3)
		// 除了 nonce，内容一样
		expect(b.body.replaceAll(b.header!, 'N')).toBe(third.body.replaceAll(third.header!, 'N'))
		// HEAD 也命中，不带正文
		const head = await page('/archive', {}, 'HEAD')
		expect([head.headers.get('x-page-cache'), await head.text()]).toEqual(['HIT', ''])
	})

	it('不走缓存：带登录 cookie、带了别的查询参数、搜索页；出错的页面不存', async () => {
		await page('/')
		const signedIn = await page('/', { cookie: 'better-auth.session_token=abc' })
		expect(signedIn.headers.get('x-page-cache')).toBeNull()
		expect(signedIn.headers.get('cache-control')).toBe('private, no-store')
		expect((await page('/?utm_source=x')).headers.get('x-page-cache')).toBeNull()
		expect((await page('/search?q=a')).headers.get('x-page-cache')).toBeNull()
		for (let i = 0; i < 2; i++) {
			const missing = await page('/posts/nope/nope')
			expect([missing.status, missing.headers.get('x-page-cache')]).toEqual([404, 'MISS'])
		}
	})

	it('webhook 清缓存时页面一起作废', async () => {
		await page('/timeline')
		expect((await page('/timeline')).headers.get('x-page-cache')).toBe('HIT')
		expect((await webhook('post.update')).status).toBe(200)
		expect((await page('/timeline')).headers.get('x-page-cache')).toBe('MISS')
	})

	it('按浏览器语言跳转先于缓存：缓存热了之后，英文浏览器照样被跳到 /en', async () => {
		await page('/')
		expect((await page('/')).headers.get('x-page-cache')).toBe('HIT')
		const english = await page('/', { 'accept-language': 'en-US,en;q=0.9' })
		expect([english.status, english.headers.get('location')]).toEqual([302, '/en'])
	})

	it('页面自己标了不许共享缓存的不存：限时公开中的付费文章（游客看到全文）不会带着全文发给下一位', async () => {
		for (let i = 0; i < 2; i++) {
			const res = await page(PREMIUM)
			expect([res.status, res.headers.get('x-page-cache'), res.headers.get('cache-control')]).toEqual([200, 'MISS', 'private, no-store'])
		}
	})

	it('core 挂了时拼出来的降级页不存、标成 no-store（前面的 CDN 也别存）；core 恢复后照常缓存', async () => {
		coreDown = true
		try {
			for (let i = 0; i < 2; i++) {
				const res = await page('/says')
				expect([res.headers.get('x-page-cache'), res.headers.get('cache-control')]).toEqual(['MISS', 'no-store'])
			}
		}
		finally {
			coreDown = false
		}
		// 挂的时候开始的 swr 后台刷新可能还在失败：多给几次机会
		let hit = false
		for (let i = 0; i < 5 && !hit; i++)
			hit = (await page('/says')).headers.get('x-page-cache') === 'HIT'
		expect(hit).toBe(true)
	})

	it('新评论（comment.* 的 webhook）只清「最近动态」，整页缓存不动', async () => {
		// 同一个缓存名 3 秒内只清一次：前面的 post.update 也清了「最近动态」，等过这个窗口，这次才真的会清
		await new Promise(resolve => setTimeout(resolve, 3100))
		await page('/archive')
		expect((await page('/archive')).headers.get('x-page-cache')).toBe('HIT')
		expect((await webhook('comment.create')).status).toBe(200)
		expect((await page('/archive')).headers.get('x-page-cache')).toBe('HIT')
	})
})
