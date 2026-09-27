/**
 * 聚合与站点：统计、新内容、前后的日记、最近动态、喜欢本站、随机说说、封禁友链、
 * 订阅源（全文与 CSP）、sitemap 与 llms.txt、主题配置走聚合接口、webhook 清缓存；浏览器里看几个挂件与页面
 */
import type { Browser, BrowserContext } from 'playwright-core'
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { createHmac } from 'node:crypto'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const SECRET = 'e2e-webhook-secret'
const THEME = { timeZone: 'Asia/Shanghai', subtitle: '经由聚合接口读到的配置' }

let likedBefore = false
/** 主题问聚合接口要主题配置时带的 `theme`（主题配置缓存 60 秒，只在开头问一次） */
let themeQuery: string | null = null

function handle(request: CoreRequest): CoreReply | undefined {
	const [path, query] = request.path.split('?')
	if (path === '/aggregate' && query?.includes('theme='))
		themeQuery = new URLSearchParams(query).get('theme')
	switch (path) {
		case '/aggregate/top':
			return { body: { data: {
				notes: [{ id: '1', nid: 9, title: '不该出现的日记', location: '某小区', coordinates: { latitude: 30.1, longitude: 120.2 } }],
				posts: [],
				says: [{ id: '10', text: '最近的一条说说', created_at: '2026-09-20T00:00:00.000Z' }],
				recently: [{ id: '184000000000000001', content: '最近的碎碎念', created_at: '2026-09-21T00:00:00.000Z' }],
			} } }
		case '/activity/recent':
			return { body: { data: {
				comment: [
					{ created_at: '2026-09-22T00:00:00.000Z', author: '路人', text: '公开日记下的评论', avatar: 'https://cravatar.cn/avatar/1', type: 'note', nid: 2, title: 'x' },
					{ created_at: '2026-09-22T00:00:00.000Z', author: '路人', text: '在谈加密日记', type: 'note', nid: 77, title: '加密日记的标题' },
				],
				like: [],
				post: [],
				note: [{ title: '整篇日记', location: '某小区' }],
			} } }
		case '/like_this':
			if (request.method === 'POST') {
				const already = likedBefore
				likedBefore = true
				return already ? { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Once a day is enough' } } } : { status: 204 }
			}
			return { body: { data: 7 } }
		case '/topics/all':
			return { body: { data: [{ id: '1', name: '示例专栏', slug: 'sample-topic', description: '', introduce: '', created_at: '2022-01-01T00:00:00.000Z' }] } }
	}
	return undefined
}

let core: FakeCore
let theme: ThemeServer

beforeAll(async () => {
	core = await startFakeCore({ theme: THEME, handle })
	theme = await startTheme(core.apiUrl, { NUXT_MX_WEBHOOK_SECRET: SECRET })
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

const get = (path: string, init?: RequestInit) => fetch(`${theme.url}${path}`, init)
const json = async <T = any>(path: string) => (await get(path)).json() as Promise<T>
const coreCalls = (pattern: RegExp) => core.requests.filter(request => pattern.test(request.path))

describe('从缓存算的', () => {
	it('统计：篇数、字数都由缓存算，不再请求 site_info', async () => {
		core.requests.length = 0
		const stats = await json('/api/mx/stats')
		expect(stats.total).toMatchObject({ notes: 2 })
		expect(stats.total.posts).toBeGreaterThan(0)
		expect(coreCalls(/site_info/)).toEqual([])
	})

	it('新内容与前后的日记', async () => {
		const updates = await json(`/api/mx/updates?since=${Date.now() - 86_400_000}`)
		expect(updates).toEqual({ count: expect.any(Number), items: expect.any(Array) })
		const around = await json('/api/mx/notes/2/around')
		expect(around.older.map((item: { path: string }) => item.path)).toEqual(['/notes/1'])
		expect((await get('/api/mx/notes/abc/around')).status).toBe(404)
	})
})

describe('调 core 的聚合', () => {
	it('最近动态：碎碎念来自 top（同一接口里带位置的日记与说说不带）；被评论的内容要在公开集合里，加密日记下的评论整条丢掉', async () => {
		const activity = await json('/api/mx/activity')
		expect(activity.thinking).toEqual([expect.objectContaining({ excerpt: '最近的碎碎念', path: '/thinking/184000000000000001' })])
		expect(activity.comments).toEqual([expect.objectContaining({ excerpt: '公开日记下的评论', path: '/notes/2', title: '周末整理书架' })])
		expect(Object.keys(activity).sort()).toEqual(['comments', 'thinking'])
		expect(JSON.stringify(activity)).not.toMatch(/加密日记|某小区|整篇日记|不该出现的日记|latitude|最近的一条说说/)
	})

	it('随机说说：从缓存里挑，不转发 core 的 /says/random', async () => {
		core.requests.length = 0
		const say = await json('/api/mx/says/random')
		expect(say.text).toBeTruthy()
		expect(coreCalls(/says\/random/)).toEqual([])
	})

	it('封禁的友链只有名字', async () => {
		const links = await json('/api/mx/links')
		expect(links.banned).toEqual(['被封的站'])
		expect(JSON.stringify(links)).not.toContain('banned.example.test')
	})
})

describe('订阅源', () => {
	it('/feed 308 到 /atom.xml；订阅源带严格的 CSP，全文只给阅读器', async () => {
		const redirect = await get('/feed', { redirect: 'manual' })
		expect(redirect.status).toBe(308)
		expect(redirect.headers.get('location')).toBe('/atom.xml')
		const feed = await get('/atom.xml')
		expect(feed.headers.get('content-type')).toContain('application/xml')
		expect(feed.headers.get('content-security-policy')).toContain('default-src \'none\'')
		const xml = await feed.text()
		expect(xml).toContain('在网站上阅读')
		expect(xml).not.toMatch(/&lt;script/)
	})

	it('说说与碎碎念各有订阅源', async () => {
		for (const path of ['/says/atom.xml', '/thinking/atom.xml']) {
			const res = await get(path)
			expect(res.status, path).toBe(200)
			expect(await res.text()).toContain('<entry>')
		}
	})

	it('XSL 不再把正文当 HTML 插进页面', async () => {
		const xsl = await (await get('/assets/atom.xsl')).text()
		expect(xsl).not.toContain('disable-output-escaping')
		expect(xsl).not.toMatch(/<script>\s*document/)
	})
})

describe('sitemap 与 llms.txt', () => {
	it('sitemap 有专栏与标签页，没有搜索与会员页', async () => {
		const xml = await (await get('/sitemap.xml')).text()
		expect(xml).toContain('/notes/series/sample-topic')
		expect(xml).toMatch(/\/posts\/tag\/[^<]+/)
		expect(xml).not.toMatch(/<loc>[^<]*\/search<\/loc>/)
		expect(xml).not.toMatch(/<loc>[^<]*\/membership<\/loc>/)
	})

	it('llms.txt 有文章、日记两节', async () => {
		const text = await (await get('/llms.txt')).text()
		expect(text).toContain('## 文章')
		expect(text).toContain('## 日记')
		expect(text).toContain('周末整理书架')
	})
})

describe('主题配置走聚合接口', () => {
	it('按 mx-clarity|yohaku|shiro 取，拿到的就是片段内容', async () => {
		const config = await json('/api/mx/theme')
		expect(config.subtitle).toBe(THEME.subtitle)
		expect(themeQuery).toBe('mx-clarity|yohaku|shiro')
	})
})

describe('webhook', () => {
	const send = (body: string, event: string, signature = createHmac('sha256', SECRET).update(body).digest('hex')) =>
		get('/api/mx/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-webhook-event': event, 'x-webhook-signature256': signature } })

	it('签名不对 401；health_check 与不认识的事件 200', async () => {
		expect((await send('{}', 'note.update', 'f'.repeat(64))).status).toBe(401)
		expect((await send('{}', 'note.update', 'nope')).status).toBe(401)
		expect(await (await send('{}', 'health_check')).json()).toEqual({ ok: true, ignored: true })
	})

	it('note.update 清掉时间线的缓存：下一次请求重新问 core', async () => {
		await get('/api/mx/timeline')
		core.requests.length = 0
		await get('/api/mx/timeline')
		expect(coreCalls(/^\/aggregate\/timeline/)).toEqual([])
		const res = await send(JSON.stringify({ id: '1', title: '改过的日记' }), 'note.update')
		expect(await res.json()).toEqual({ ok: true })
		await get('/api/mx/timeline')
		expect(coreCalls(/^\/aggregate\/timeline/).length).toBeGreaterThan(0)
		// 日志里只有事件名，没有 payload
		expect(theme.logs.join('\n')).toContain('"webhookEvent":"note.update"')
		expect(theme.logs.join('\n')).not.toContain('改过的日记')
	})
})

const chrome = chromePath()

describe.skipIf(!chrome)('浏览器里的挂件与页面', () => {
	let browser: Browser
	let context: BrowserContext

	beforeAll(async () => {
		browser = await chromium.launch({ executablePath: chrome, headless: true })
		context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
		await context.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
	})

	afterAll(async () => {
		await browser?.close()
	})

	async function open(path: string) {
		const page = await context.newPage()
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		await page.goto(`${theme.url}${path}`, { waitUntil: 'networkidle' })
		return { page, errors }
	}

	it('首页：侧栏只有统计、最近动态、技术信息；喜欢本站在统计的标题行（浏览器直连 core，经同源的 /api/v3）', async () => {
		core.requests.length = 0
		const { page, errors } = await open('/')
		await page.getByText('公开日记下的评论').waitFor()
		await page.getByText('最近的碎碎念').waitFor()
		await page.getByText('文章 / 日记').waitFor()
		expect((await page.locator('#blog-aside .widget-header').allTextContents()).map(text => text.trim())).toEqual([expect.stringMatching(/^博客统计/), '最近动态', '技术信息'])
		const like = page.getByRole('button', { name: '喜欢本站' })
		await like.getByText('7').waitFor()
		await like.click()
		await page.locator('button.like-site[aria-pressed="true"]').getByText('8').waitFor()
		const liked = core.requests.find(request => request.method === 'POST' && request.path.startsWith('/like_this'))
		expect(String(liked?.headers['user-agent'])).toMatch(/Chrome/)
		expect(errors).toEqual([])
		await page.close()
	})

	it('上次来过之后有新内容时，首页提示一次；第一次来不提示', async () => {
		const { page } = await open('/about')
		// 同一个浏览器上下文里前面的测试打开过首页，先清掉
		await page.evaluate(() => localStorage.removeItem('mx-clarity:last-visit'))
		await page.goto(`${theme.url}/`, { waitUntil: 'networkidle' })
		expect(await page.getByText(/你上次来过之后/).count()).toBe(0)
		// 夹具里的内容离现在多远不固定：按接口的结果判断该不该提示
		const since = Date.now() - 20 * 86_400_000
		const { count } = await json(`/api/mx/updates?since=${since}`)
		await page.evaluate(value => localStorage.setItem('mx-clarity:last-visit', String(value)), since)
		await page.reload({ waitUntil: 'networkidle' })
		expect(await page.getByText(/你上次来过之后/).count()).toBe(count ? 1 : 0)
		// 看过一次就把时间记成现在，再来不提示
		await page.reload({ waitUntil: 'networkidle' })
		expect(await page.getByText(/你上次来过之后/).count()).toBe(0)
		await page.close()
	})

	it('时间线的三种视图：密一行一条、概览点月份回到舒并滚到那个月，视图写进地址', async () => {
		const { page, errors } = await open('/timeline')
		await page.getByRole('button', { name: '密', exact: true }).click()
		await page.waitForURL(url => url.searchParams.get('view') === 'dense')
		expect(await page.locator('.timeline-dense li').count()).toBeGreaterThan(0)
		await page.getByRole('button', { name: '概览', exact: true }).click()
		await page.waitForURL(url => url.searchParams.get('view') === 'skim')
		const month = page.locator('.timeline-skim button:not([disabled])').first()
		await month.click()
		await page.waitForURL(url => !url.searchParams.has('view'))
		expect(await page.locator('.timeline-month').count()).toBeGreaterThan(0)
		// 筛选链接保留视图
		await page.getByRole('button', { name: '密', exact: true }).click()
		await page.waitForURL(url => url.searchParams.get('view') === 'dense')
		expect(await page.locator('.timeline-filter').getByRole('link', { name: '日记', exact: true }).getAttribute('href')).toBe('/timeline?type=note&view=dense')
		// 切回舒：选择记在本机，下次打开还是它
		await page.getByRole('button', { name: '舒', exact: true }).click()
		await page.waitForURL(url => !url.searchParams.has('view'))
		expect(errors).toEqual([])
		await page.close()
	})

	it('带 ?peek-to= 打开：目标是本站文章或日记就 302 过去，别的忽略', async () => {
		const res = await get('/?peek-to=/posts/tech/mx-syntax-sample', { redirect: 'manual' })
		expect(res.status).toBe(302)
		expect(res.headers.get('location')).toBe('/posts/tech/mx-syntax-sample')
		for (const bad of ['//evil.test/posts/a/b', 'https://evil.test/', '/about'])
			expect((await get(`/?peek-to=${encodeURIComponent(bad)}`, { redirect: 'manual' })).status, bad).toBe(200)
	})

	it('时间线筛选、标签总览、日记的前后、已失效的友链', async () => {
		const { page, errors } = await open('/timeline?type=note')
		expect(await page.locator('.timeline-list > *').count()).toBe(2)
		await page.getByRole('link', { name: '文章', exact: true }).first().waitFor()
		await page.goto(`${theme.url}/posts/tag`, { waitUntil: 'networkidle' })
		await page.getByRole('heading', { name: /全部标签/ }).waitFor()
		expect(await page.locator('.tags-cloud li').count()).toBeGreaterThan(0)
		await page.goto(`${theme.url}/notes/2`, { waitUntil: 'networkidle' })
		await page.getByText('前后的日记').waitFor()
		await page.goto(`${theme.url}/link`, { waitUntil: 'networkidle' })
		await page.getByText(/已失效/).click()
		await page.getByText('被封的站').waitFor()
		expect(errors).toEqual([])
		await page.close()
	})
})
