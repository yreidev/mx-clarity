import type { AddressInfo } from 'node:net'
/**
 * 富内容：一篇 markdown 文章里放 core 投影的股票（快照与 K 线）、地图块与一个单独成段的 GitHub 文件链接，
 * 另有文章附带的 Skill。GitHub 走一个只记下 CONNECT 目标、一律回 502 的本地代理（主题进程设了 NODE_USE_ENV_PROXY），
 * 看服务端确实去取了、取不到时照旧是链接；浏览器里看 Skill 页、K 线的十字线、交互地图与它加载不了时的示意图
 */
import type { Browser, BrowserContext } from 'playwright-core'
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { chromium, devices } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const PATH = '/posts/tech/rich-align'
const GITHUB_URL = 'https://github.com/mx-space/core/blob/main/README.md#L1-L3'
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))
/** core 的 litexml：`data` 是 JSON，引号写成 &quot; */
const node = (type: string, data: unknown) => `<node type="${type}" id="${type}1" data="${JSON.stringify(data).replaceAll('"', '&quot;')}" />`

const TEXT = [
	'开头一段。',
	node('stock', { variant: 'snapshot', symbol: 'aapl' }),
	'中间一段。',
	GITHUB_URL,
	node('stock', { variant: 'kline', symbol: 'aapl', range: { interval: '1d', from: '2026-01-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' } }),
	node('map', { title: '东京', pois: [{ lat: 35.68, lon: 139.76, title: '东京站' }, { lat: 35.71, lon: 139.81, title: '晴空塔' }] }),
	'结尾一段。',
].join('\n\n')

function post() {
	const data = fixture('post-syntax-sample')
	Object.assign(data.data, { slug: 'rich-align', title: '富内容对齐示例', text: TEXT })
	data.meta = { ...data.meta, skills: [{ id: '2', name: 'demo-skill', description: '示例 Skill', raw_url: 'https://blog.example.com/api/v3/s/sk/demo/SKILL.md', assets: [] }] }
	return data
}

const SKILL = '---\nname: 写作助手\ndescription: 帮你改稿\n---\n# 写作助手\n\n先看[说明](docs/guide.md)，再看图 ![示意](img/a.png)。\n\n<script>alert(1)</script>\n'
const DAY = 86_400
const START = Date.parse('2026-01-02T00:00:00.000Z') / 1000
const BARS = Array.from({ length: 30 }, (_, i) => ({ timestamp: START + i * DAY, open: 200 + i, high: 203 + i, low: 198 + i, close: 201 + i, volume: 1000 + i }))

function handle(request: CoreRequest): CoreReply | undefined {
	const path = request.path.split('?')[0]
	if (path === PATH)
		return { body: post() }
	if (path === '/s/sk/demo/SKILL.md')
		return { raw: SKILL, type: 'text/markdown' }
	if (path === '/s/sk/demo/docs/guide.md')
		return { raw: '# 说明\n', type: 'text/markdown; charset=utf-8' }
	if (path === '/s/sk/demo/evil.html')
		return { raw: '<script>alert(1)</script>', type: 'text/html' }
	if (path === '/s/sk/demo/moved.png')
		return { status: 302, raw: '', headers: { location: 'http://127.0.0.1:1/elsewhere.png' } }
	if (path === '/fn/built-in/stock_quote')
		return { body: { data: { symbol: 'AAPL', longName: 'Apple Inc', exchange: 'NASDAQ', currency: 'USD', price: 210.5, previousClose: 200, dayHigh: 212, dayLow: 205, fiftyTwoWeekHigh: 230, fiftyTwoWeekLow: 160, volume: 123456, sparkline: [{ timestamp: 1, close: 200 }, { timestamp: 2, close: 210.5 }], asOf: 1719830400, marketState: 'closed' } } }
	if (path === '/fn/built-in/stock_bars')
		return { body: { data: { meta: { longName: 'Apple Inc', currency: 'USD' }, bars: BARS } } }
	return undefined
}

let core: FakeCore
let theme: ThemeServer
const connects: string[] = []
const proxy = createServer((_req, res) => {
	res.writeHead(502)
	res.end()
})
proxy.on('connect', (req, socket) => {
	connects.push(req.url ?? '')
	socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
})

beforeAll(async () => {
	await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
	core = await startFakeCore({ theme: { timeZone: 'Asia/Shanghai' }, handle })
	theme = await startTheme(core.apiUrl, { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`, NO_PROXY: '127.0.0.1,localhost' })
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
	proxy.close()
})

const get = (path: string, init?: RequestInit) => fetch(`${theme.url}${path}`, init)

describe('服务端', () => {
	it('markdown 里 core 投影的股票、K 线、地图转成块并补好数据；前后的段落都在', async () => {
		const detail = await (await get(`/api/mx${PATH}`)).json()
		const raw = JSON.stringify(detail.body)
		expect(raw.match(/"tag":"stock-block"/g)).toHaveLength(2)
		expect(raw).toContain('"price":210.5')
		expect(raw).toContain('"variant":"kline"')
		// 每根带「时间、开、高、低、收、量」
		expect(raw).toContain(`[${START},200,203,198,201,1000]`)
		expect(raw).toContain('"tag":"map-block"')
		expect(raw).toContain('"markerX"')
		for (const text of ['开头一段。', '中间一段。', '结尾一段。'])
			expect(raw).toContain(text)
	})

	it('GitHub 文件：服务端去 raw.githubusercontent.com 取；取不到照旧是链接，读者的页面里没有 GitHub 的资源', async () => {
		const started = Date.now()
		const detail = await (await get(`/api/mx${PATH}?ts=${Date.now()}`)).json()
		expect(Date.now() - started).toBeLessThan(5000)
		expect(connects).toContain('raw.githubusercontent.com:443')
		const raw = JSON.stringify(detail.body)
		expect(raw).toContain(`"href":"${GITHUB_URL}"`)
		expect(raw).not.toContain('github-embed')
	})

	it('Skill：解析开头的名称与说明，相对链接改写到本站，脚本去掉', async () => {
		const skill = await (await get('/api/mx/skills/demo')).json()
		expect(skill).toMatchObject({ slug: 'demo', name: '写作助手', description: '帮你改稿', raw: '/skills/demo/SKILL.md' })
		const raw = JSON.stringify(skill.body)
		expect(raw).toContain('"href":"/skills/demo/docs/guide.md"')
		expect(raw).toContain('"src":"/skills/demo/img/a.png"')
		expect(raw).not.toContain('alert(1)')
		expect(raw).not.toContain('写作助手')
		expect((await get('/api/mx/skills/nope')).status).toBe(404)
		expect((await get('/api/mx/skills/..')).status).toBe(404)
	})

	it('Skill 附件转发：类型照 core 的，HTML 按纯文本给；路径不像文件名、core 重定向的一律 404', async () => {
		const md = await get('/skills/demo/SKILL.md')
		expect(md.status).toBe(200)
		expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
		expect(await md.text()).toContain('name: 写作助手')
		expect((await get('/skills/demo/docs/guide.md')).headers.get('content-type')).toBe('text/markdown; charset=utf-8')
		const html = await get('/skills/demo/evil.html')
		expect(html.headers.get('content-type')).toBe('text/plain; charset=utf-8')
		expect(html.headers.get('x-content-type-options')).toBe('nosniff')
		expect(html.headers.get('content-security-policy')).toBe('default-src \'none\'')
		for (const path of ['/skills/demo/moved.png', '/skills/demo/%2E%2E/x', '/skills/demo/a%3Fb', '/skills/demo/missing.md'])
			expect((await get(path)).status, path).toBe(404)
	})
})

const chrome = chromePath()

describe.skipIf(!chrome)('浏览器', () => {
	let browser: Browser
	let context: BrowserContext

	beforeAll(async () => {
		browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--enable-unsafe-swiftshader'] })
		context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
		await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: theme.url })
		await context.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
	})

	afterAll(async () => {
		await browser?.close()
	})

	it('文章下面的 Skill 进本站的 Skill 页：名称、说明、正文；「复制提示词」复制 SKILL.md 的完整地址', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const link = page.locator('a[href="/skills/demo"]')
		await link.scrollIntoViewIfNeeded()
		await link.click()
		await page.waitForURL(url => url.pathname === '/skills/demo')
		await page.getByRole('heading', { level: 1, name: '写作助手' }).waitFor()
		await page.getByText('AI Skill').waitFor()
		await page.getByText('帮你改稿').waitFor()
		expect(await page.locator('.article a[href="/skills/demo/docs/guide.md"]').count()).toBe(1)
		await page.getByRole('button', { name: '复制提示词' }).click()
		await page.getByRole('button', { name: '已复制' }).waitFor()
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('请阅读并遵循这份 Skill：http://localhost:2323/skills/demo/SKILL.md')
		await page.close()
	})

	it('不存在的 Skill 是 404 页', async () => {
		const page = await context.newPage()
		const res = await page.goto(`${theme.url}/skills/nope`, { waitUntil: 'networkidle' })
		expect(res?.status()).toBe(404)
		await page.getByText('这个 Skill 不存在').waitFor()
		await page.close()
	})

	it('K 线：指针移上去画十字线、显示那一根的日期；移开回到最后一根', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const chart = page.locator('svg.stock-kline')
		await chart.scrollIntoViewIfNeeded()
		const date = page.locator('.stock-bar-date')
		const last = await date.textContent()
		expect(await page.locator('.crosshair').count()).toBe(0)
		const box = (await chart.boundingBox())!
		await page.mouse.move(box.x + 3, box.y + box.height / 2)
		await page.locator('.crosshair').waitFor()
		const first = await date.textContent()
		expect(first).not.toBe(last)
		expect(first).toBe('2026/01/02')
		await page.mouse.move(box.x + box.width / 2, box.y - 200)
		await page.locator('.crosshair').waitFor({ state: 'detached' })
		expect(await date.textContent()).toBe(last)
		await page.close()
	})

	it('交互地图：底图能取到时换成地图，地点是带编号的标记，点开是小卡片；worker 没被内容安全策略拦', async () => {
		const page = await context.newPage()
		const violations: string[] = []
		page.on('console', (message) => {
			if (/Content Security Policy/i.test(message.text()))
				violations.push(message.text())
		})
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		// 只给一个纯底色的样式：不取瓦片、字形
		await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eeeeee' } }] }) }))
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const block = page.locator('.map-block')
		await block.scrollIntoViewIfNeeded()
		await block.locator('.map-live.ready').waitFor({ timeout: 15_000 })
		expect(await block.locator('.map-chart').isVisible()).toBe(false)
		expect(await block.locator('.map-pin').count()).toBe(2)
		await block.getByRole('button', { name: '晴空塔' }).click()
		const popup = page.locator('.maplibregl-popup')
		await popup.getByText('晴空塔').waitFor()
		await popup.getByRole('link', { name: '在 OpenStreetMap 打开' }).waitFor()
		expect(violations).toEqual([])
		expect(errors).toEqual([])
		await page.close()
	})

	it('手机上：页面不横向溢出（代码、表格、图表在自己的框里滑动），地图框够高', async () => {
		const phone = await browser.newContext({ ...devices['iPhone 13'] })
		await phone.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
		const page = await phone.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		// 滚一遍，让滚到才渲染的块都出来
		await page.evaluate(async () => {
			for (let y = 0; y < document.body.scrollHeight; y += 400) {
				window.scrollTo(0, y)
				await new Promise(resolve => setTimeout(resolve, 60))
			}
		})
		expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
		const stage = page.locator('.map-stage')
		await stage.scrollIntoViewIfNeeded()
		expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(18 * 16 - 1)
		await phone.close()
	})

	it('底图取不到时照旧是示意图与地点清单', async () => {
		const page = await context.newPage()
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const block = page.locator('.map-block')
		await block.scrollIntoViewIfNeeded()
		await page.waitForTimeout(1500)
		expect(await block.locator('.map-chart').isVisible()).toBe(true)
		expect(await block.locator('.map-live.ready').count()).toBe(0)
		await block.getByRole('link', { name: '东京站' }).waitFor()
		expect(errors).toEqual([])
		await page.close()
	})
})
