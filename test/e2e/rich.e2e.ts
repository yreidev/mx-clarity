/**
 * 富内容与互动：一篇 Lexical 示例文章里放图集、附件、画板、投票、股票、地图、链接卡片与站内链接，
 * 看服务端嵌进去的数据、投票的转发、浏览器里的投票与站内预览
 */
import type { Browser, BrowserContext } from 'playwright-core'
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const PATH = '/posts/tech/rich-sample'
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))

const paragraph = (...children: Record<string, unknown>[]) => ({ type: 'paragraph', children })
const text = (value: string) => ({ type: 'text', text: value })
const STATE = {
	root: {
		type: 'root',
		children: [
			paragraph(text('开头一段。')),
			{ type: 'gallery', layout: 'grid', images: [{ src: 'https://img.example.test/1.png', alt: '图一', width: 800, height: 600, accent: '#336699', thumbhash: 'HBkSHYSIeHiPiHh8eJd4eTN0EEQG' }] },
			{ type: 'file', src: 'https://files.example.test/report.pdf', name: '报告.pdf', size: 2048, ext: 'pdf' },
			{ type: 'excalidraw', snapshot: JSON.stringify({ elements: [{ type: 'text', text: '画板里的字' }, { type: 'rectangle' }] }) },
			{ type: 'poll', pollId: 'p_rich1', question: '你喜欢哪个？', mode: 'single', options: [{ id: 'o_cat', label: '猫' }, { id: 'o_dog', label: '狗' }] },
			{ type: 'stock', variant: 'snapshot', symbol: 'aapl' },
			{ type: 'map', title: '东京', pois: [{ lat: 35.68, lon: 139.76, title: '东京站' }, { lat: 35.71, lon: 139.81, title: '晴空塔' }] },
			{ type: 'link-card', url: 'https://github.com/a/b', title: '旧标题' },
			paragraph({ type: 'autolink', url: 'https://example.test/article', children: [text('https://example.test/article')] }),
			paragraph(text('站内链接：'), { type: 'link', url: '/posts/tech/mx-syntax-sample', children: [text('语法示例')] }),
		],
	},
}

function richPost() {
	const post = fixture('post-syntax-sample')
	Object.assign(post.data, { slug: 'rich-sample', title: '富内容示例', content_format: 'lexical', content: JSON.stringify(STATE), text: '' })
	post.meta = { ...post.meta, enrichments: {
		'https://github.com/a/b': { title: 'a/b 仓库', description: '仓库说明', category: 'github', url: 'javascript:alert(1)', attributes: [{ key: 'stars', value: 42, format: 'number' }], thumbnail_image: { url: 'https://tracker.example.test/pixel.png' } },
		'https://example.test/article': { title: '外站文章的标题', description: '外站文章的描述', category: 'web' },
	} }
	return post
}

let voted = false

function handle(request: CoreRequest): CoreReply | undefined {
	const path = request.path.split('?')[0]
	if (path === PATH)
		return { body: richPost() }
	if (path === '/polls')
		return { body: { data: { p_rich1: { tallies: voted ? { o_cat: 3 } : { o_cat: 2 }, total_votes: voted ? 3 : 2, ...(voted ? { user_vote: ['o_cat'] } : {}), status: 'ready', closed: false, can_vote: !voted } } } }
	if (path === '/polls/p_rich1/vote') {
		voted = true
		return { body: { data: { tallies: { o_cat: 3 }, total_votes: 3, user_vote: ['o_cat'], status: 'ready', closed: false, can_vote: false } } }
	}
	if (path === '/fn/built-in/stock_quote')
		return { body: { data: { symbol: 'AAPL', longName: 'Apple Inc', exchange: 'NASDAQ', currency: 'USD', price: 210.5, previousClose: 200, dayHigh: 212, dayLow: 205, fiftyTwoWeekHigh: 230, fiftyTwoWeekLow: 160, volume: 123456, sparkline: [{ timestamp: 1, close: 200 }, { timestamp: 2, close: 205 }, { timestamp: 3, close: 210.5 }], asOf: 1719830400, marketState: 'closed' } } }
	return undefined
}

let core: FakeCore
let theme: ThemeServer

beforeAll(async () => {
	core = await startFakeCore({ theme: { timeZone: 'Asia/Shanghai' }, handle })
	theme = await startTheme(core.apiUrl)
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

const get = (path: string, init?: RequestInit) => fetch(`${theme.url}${path}`, init)
const coreCalls = (pattern: RegExp) => core.requests.filter(request => pattern.test(request.path))

describe('服务端', () => {
	it('详情里嵌好了行情与地图的图、链接卡片的文字；第三方图片与条目里的 url 不出现', async () => {
		const detail = await (await get(`/api/mx${PATH}`)).json()
		const raw = JSON.stringify(detail.body)
		expect(raw).toContain('"tag":"stock-block"')
		expect(raw).toContain('"price":210.5')
		expect(raw).toContain('"tag":"map-block"')
		expect(raw).toContain('"markerX"')
		expect(raw).toContain('a/b 仓库')
		expect(raw).toContain('外站文章的标题')
		expect(raw).toContain('"tag":"mx-poll"')
		for (const leaked of ['tracker.example.test', 'javascript:'])
			expect(raw).not.toContain(leaked)
		// 行情不转访客 IP：是全站共享的数据
		const [quote] = coreCalls(/^\/fn\/built-in\/stock_quote/)
		expect(new URL(quote!.path, 'http://x').searchParams.get('symbol')).toBe('AAPL')
	})
})

const chrome = chromePath()

describe.skipIf(!chrome)('浏览器', () => {
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

	it('富内容渲染出来：图集、附件、画板的文字、行情、地图的地点、链接卡片', async () => {
		const page = await context.newPage()
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.locator('.mx-gallery img').first().waitFor()
		await page.getByText('报告.pdf').waitFor()
		await page.getByText(/画板里的字/).waitFor()
		await page.getByText('Apple Inc').waitFor()
		await page.getByRole('link', { name: '晴空塔' }).waitFor()
		await page.getByText('a/b 仓库').waitFor()
		await page.getByText('外站文章的标题').waitFor()
		// 主色当底色（加载前），模糊图不打任何外部请求
		expect(errors).toEqual([])
		await page.close()
	})

	it('投票：选了点「投票」才提交，提交后显示结果与「你已投票」；浏览器直连 core，取状态带 ts 绕过 core 的缓存，请求体是 optionIds', async () => {
		voted = false
		core.requests.length = 0
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const poll = page.locator('.mx-poll-card')
		await poll.scrollIntoViewIfNeeded()
		await poll.getByText('2 人参与').waitFor()
		// 没选时按钮禁用：主按钮的白字要换成灰字，不然白字配浅底看不见
		const submit = poll.getByRole('button', { name: '投票' })
		expect(await submit.isDisabled()).toBe(true)
		expect(await submit.evaluate(el => getComputedStyle(el).color)).not.toBe('rgb(255, 255, 255)')
		await poll.getByLabel('猫').check()
		await poll.getByRole('button', { name: '投票' }).click()
		await poll.getByText(/你已投票/).waitFor()
		await poll.getByText('100%').waitFor()
		const [status] = coreCalls(/^\/polls\?/)
		expect(Number(new URL(status!.path, 'http://x').searchParams.get('ts'))).toBeGreaterThan(0)
		expect(String(status!.headers['user-agent'])).toMatch(/Chrome/)
		const [vote] = coreCalls(/^\/polls\/p_rich1\/vote/)
		expect(JSON.parse(vote!.body)).toEqual({ optionIds: ['o_cat'] })
		await page.close()
	})

	it('站内链接预览：宽屏上点正文里的文章链接弹窗读全文，Esc 关掉、焦点回到链接', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const link = page.getByRole('link', { name: '语法示例' })
		await link.scrollIntoViewIfNeeded()
		await link.click()
		const dialog = page.locator('dialog.peek[open]')
		await dialog.waitFor()
		await dialog.getByRole('heading', { name: /语法/ }).waitFor()
		// 地址栏不变
		expect(new URL(page.url()).pathname).toBe(PATH)
		await page.keyboard.press('Escape')
		await dialog.waitFor({ state: 'detached' }).catch(() => undefined)
		expect(await page.locator('dialog.peek[open]').count()).toBe(0)
		expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('语法示例')
		// 按住 Ctrl 照常（新标签页），不弹
		await page.close()
	})

	it('站内链接预览加载失败一次之后，再打开会重新取，不会一直显示「加载不出来」', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		// ofetch 对 GET 的网络错误会自己重试一次：连着拦两次才算这次取失败
		let failures = 2
		await page.route('**/api/mx/posts/tech/mx-syntax-sample', (route) => {
			if (failures <= 0)
				return route.continue()
			failures--
			return route.abort()
		})
		const link = page.getByRole('link', { name: '语法示例' })
		await link.scrollIntoViewIfNeeded()
		await link.click()
		const dialog = page.locator('dialog.peek[open]')
		await dialog.getByRole('heading', { name: '暂时加载不出来' }).waitFor()
		await page.keyboard.press('Escape')
		await dialog.waitFor({ state: 'detached' }).catch(() => undefined)
		await link.click()
		await page.locator('dialog.peek[open]').getByRole('heading', { name: /语法/ }).waitFor()
		await page.close()
	})

	it('站内链接预览只接正文里的：首页列表里点文章直接跳转，不弹窗', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}/`, { waitUntil: 'networkidle' })
		const link = page.locator('#main-content a[href="/posts/tech/mx-syntax-sample"]').first()
		expect(await link.evaluate(element => element.closest('.article'))).toBeNull()
		await link.click()
		await page.waitForURL(url => url.pathname === '/posts/tech/mx-syntax-sample')
		expect(await page.locator('dialog.peek[open]').count()).toBe(0)
		await page.close()
	})
})
