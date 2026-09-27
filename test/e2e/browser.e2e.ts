/**
 * 真浏览器里的页面：内容安全策略下没有报错、站长脚本只执行一次、富内容照常渲染、几处无障碍要求。
 * 对外的请求一律拦下：站长脚本换成一段计数的假脚本，字体、视频播放器直接中止，测试不依赖外网
 */
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const THEME_SCRIPT = 'https://stats.example.test/script.js'
const THEME = { timeZone: 'Asia/Shanghai', scripts: [{ src: THEME_SCRIPT, defer: true }] }
const PAGES = ['/', '/posts/tech/mx-syntax-sample', '/posts/tech/xss-probe', '/posts/tech', '/archive', '/timeline', '/notes', '/notes/2', '/notes/series', '/notes/series/sample-topic', '/thinking', '/thinking/184833891280883712', '/says', '/link', '/projects', '/membership', '/search?q=示例', '/about', '/nope-404']

const chrome = chromePath()

describe.skipIf(!chrome)('浏览器', () => {
	let core: FakeCore
	let theme: ThemeServer
	let browser: Browser
	let context: BrowserContext
	const external: string[] = []

	beforeAll(async () => {
		// 日记详情慢一点，站内跳转时看得到加载状态
		core = await startFakeCore({ theme: THEME, slow: /^\/notes\/nid\// })
		theme = await startTheme(core.apiUrl)
		browser = await chromium.launch({ executablePath: chrome, headless: true })
		context = await browser.newContext()
		await context.route('**/*', (route) => {
			const url = route.request().url()
			if (url.startsWith(theme.url))
				return route.continue()
			external.push(url)
			if (url === THEME_SCRIPT)
				return route.fulfill({ contentType: 'text/javascript', body: 'window.__themeScriptRuns = (window.__themeScriptRuns || 0) + 1' })
			return route.abort()
		})
		// CSP 违规与 aria-busy 的变化记在页面里；注入脚本走调试协议，不受 CSP 管
		await context.addInitScript(() => {
			const w = window as unknown as { __csp: string[], __busy: string[] }
			w.__csp = []
			w.__busy = []
			document.addEventListener('securitypolicyviolation', event => w.__csp.push(`${event.violatedDirective} ${event.blockedURI}`))
			new MutationObserver(records => records.forEach(record => w.__busy.push(String((record.target as Element).getAttribute('aria-busy')))))
				.observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-busy'] })
		})
	})

	afterAll(async () => {
		await browser?.close()
		await theme?.close()
		await core?.close()
	})

	async function open(path: string) {
		const page = await context.newPage()
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		const res = await page.goto(`${theme.url}${encodeURI(path)}`, { waitUntil: 'networkidle' })
		return { page, errors, status: res?.status() ?? 0 }
	}

	const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
	const themeScriptRuns = (page: Page) => page.evaluate(() => (window as unknown as { __themeScriptRuns?: number }).__themeScriptRuns ?? 0)

	it('逐页打开：没有 CSP 违规、没有页面错误；站长脚本执行且只执行一次', async () => {
		for (const path of PAGES) {
			const { page, errors, status } = await open(path)
			expect(status, path).toBeLessThan(500)
			expect(await violations(page), path).toEqual([])
			expect(errors, path).toEqual([])
			expect(await themeScriptRuns(page), path).toBe(1)
			await page.close()
		}
	})

	it('站内跳转：脚本由 strict-dynamic 放行，没有违规；站长脚本不重复插入；加载时容器 aria-busy', async () => {
		const { page, errors } = await open('/')
		const push = (path: string) => page.evaluate(to => ([...document.querySelectorAll('*')].find(el => '__vue_app__' in el) as unknown as { __vue_app__: { config: { globalProperties: { $router: { push: (p: string) => Promise<void> } } } } }).__vue_app__.config.globalProperties.$router.push(to), path)
		for (const path of ['/posts/tech/mx-syntax-sample', '/archive', '/notes/2', '/thinking', '/membership']) {
			// push 在路由确认后就返回，页面的数据还在取：等过加载指示器的 200 毫秒节流，再等 aria-busy 去掉才跳下一页
			await push(path)
			await page.waitForTimeout(300)
			await page.waitForFunction(() => !document.querySelector('#main-content')?.hasAttribute('aria-busy'))
		}
		expect(await violations(page)).toEqual([])
		expect(errors).toEqual([])
		expect(await themeScriptRuns(page)).toBe(1)
		expect(await page.locator(`script[src="${THEME_SCRIPT}"]`).count()).toBe(1)
		// 日记详情慢 800 毫秒：跳过去的那段时间主体容器是 aria-busy，完了就去掉
		expect(await page.evaluate(() => (window as unknown as { __busy: string[] }).__busy)).toContain('true')
		expect(await page.locator('#main-content').getAttribute('aria-busy')).toBeNull()
		await page.close()
	})

	it('文章页：代码块、公式、mermaid、视频照常渲染；只有一个 keywords；代码高亮不从 esm.sh 取', async () => {
		const { page } = await open('/posts/tech/mx-syntax-sample')
		await page.locator('.mermaid-diagram').scrollIntoViewIfNeeded()
		await page.locator('.mermaid-diagram svg').waitFor()
		expect(await page.locator('pre.shiki').count()).toBeGreaterThan(0)
		expect(await page.locator('.katex').count()).toBeGreaterThan(0)
		expect(await page.locator('iframe[src^="https://player.bilibili.com/"]').count()).toBe(1)
		expect(await page.locator('meta[name="keywords"]').count()).toBeLessThanOrEqual(1)
		expect(await violations(page)).toEqual([])
		expect(external.filter(url => url.includes('esm.sh'))).toEqual([])
		await page.close()
	})

	it('无障碍：剧透能用键盘展开、提及链接带平台名、侧栏的搜索是按钮', async () => {
		const { page } = await open('/posts/tech/mx-syntax-sample')
		const spoiler = page.locator('.blur[role="button"]').first()
		expect(await spoiler.getAttribute('aria-expanded')).toBe('false')
		expect(await spoiler.getAttribute('aria-label')).toBe('剧透内容，按下显示')
		await spoiler.focus()
		await page.keyboard.press('Enter')
		expect(await spoiler.getAttribute('aria-expanded')).toBe('true')
		expect(await page.locator('a[aria-label="X 用户 example"]').count()).toBe(1)
		expect(await page.locator('button.search-btn').count()).toBe(1)
		await page.close()
	})
})
