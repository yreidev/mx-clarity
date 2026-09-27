/**
 * 界面语言跟着前缀走、按浏览器语言跳转、语言建议、界面语言切换、标签译名与列表的译文标记。
 * 站点开了英文、日文、韩文；按日文取时列表里第一篇是译文，带这一页标签的译名
 */
import type { Browser, BrowserContext } from 'playwright-core'
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const TRANSLATED_ID = '183620000000000001'
const DETAIL = '/posts/tech/xss-probe'
const GLOSSARY = { tags: [{ source: 'security', translated: 'セキュリティ' }, { source: 'syntax', translated: '構文' }] }
const TRANSLATION = { [TRANSLATED_ID]: { article: { is_translated: true, source_lang: 'zh', target_lang: 'ja', available_translations: ['ja'] } } }
/** 日记列表里第一篇（nid 2）有日文译文 */
const NOTE_TRANSLATION = { 184834950644633600: { article: { is_translated: true, source_lang: 'zh', target_lang: 'ja', available_translations: ['ja'] } } }
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))

/** 只改按日文取的文章、日记列表与那篇详情，其余照固定夹具 */
function handle(request: CoreRequest): CoreReply | undefined {
	const url = new URL(request.path, 'http://core')
	if (url.searchParams.get('lang') !== 'ja')
		return undefined
	if (url.pathname === '/posts') {
		const page = fixture('posts-page')
		page.data[0].title = 'XSSのサンプル'
		page.meta = { ...page.meta, pagination: { ...page.meta.pagination, total: 2, total_pages: 1 }, translation: TRANSLATION, glossary: GLOSSARY }
		return { body: page }
	}
	if (url.pathname === '/notes') {
		const notes = fixture('notes-page')
		notes.data[0].title = '週末の本棚整理'
		notes.meta = { ...notes.meta, translation: NOTE_TRANSLATION }
		return { body: notes }
	}
	if (url.pathname === DETAIL) {
		const post = fixture('post-xss-probe')
		post.meta = { ...post.meta, translation: TRANSLATION, glossary: GLOSSARY }
		return { body: post }
	}
	return undefined
}

let core: FakeCore
let theme: ThemeServer

beforeAll(async () => {
	core = await startFakeCore({ theme: { i18n: { languages: ['en', 'ja', 'ko'] } }, handle })
	theme = await startTheme(core.apiUrl)
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

/** 按浏览器的样子要页面：要 HTML、普通 UA，不跟跳转 */
function page(path: string, headers: Record<string, string> = {}) {
	return fetch(`${theme.url}${path}`, {
		redirect: 'manual',
		headers: { 'accept': 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)', ...headers },
	})
}
const langCookieOf = (res: Response) => res.headers.getSetCookie().find(cookie => cookie.startsWith('mx-lang='))

describe('按浏览器语言跳转', () => {
	it('不带前缀的页面按 Accept-Language 302 到开了的语言，保留查询；没开的语言按次选；回应带 Vary', async () => {
		const res = await page('/archive?page=2', { 'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5' })
		expect(res.status).toBe(302)
		expect(res.headers.get('location')).toBe('/ja/archive?page=2')
		expect(res.headers.get('vary')).toMatch(/Accept-Language/i)
		expect((await page('/', { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' })).headers.get('location')).toBe('/en')
	})

	it('不跳：首选中文、选过中文、详情页、爬虫、看原文、接口与订阅源', async () => {
		const ja = { 'accept-language': 'ja' }
		const cases: [string, Record<string, string>][] = [
			['/', { 'accept-language': 'zh-CN,ja;q=0.8' }],
			['/', { ...ja, cookie: 'mx-lang=zh' }],
			[DETAIL, ja],
			['/', { ...ja, 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
			['/?lang=original', ja],
			['/api/mx/timeline', ja],
			['/atom.xml', ja],
		]
		for (const [path, headers] of cases)
			expect((await page(path, headers)).status, `${path} ${JSON.stringify(headers)}`).toBe(200)
		// /feed 本来就转到 /atom.xml，不加语言前缀
		expect((await page('/feed', ja)).headers.get('location')).toBe('/atom.xml')
	})

	it('选过的语言优先于浏览器；进前缀版会记下这个语言（已经是它就不再写）', async () => {
		expect((await page('/', { 'accept-language': 'en', 'cookie': 'mx-lang=ko' })).headers.get('location')).toBe('/ko')
		const res = await page('/ja/archive', { 'accept-language': 'zh-CN' })
		expect(res.status).toBe(200)
		expect(langCookieOf(res)).toMatch(/^mx-lang=ja;.*Path=\/.*SameSite=Lax/i)
		expect(langCookieOf(await page('/ja/archive', { cookie: 'mx-lang=ja' }))).toBeUndefined()
	})
})

describe('界面语言跟着前缀走', () => {
	it('/ja 日文界面、/ko 韩文、/en 英文，html 标对语言；没开的语言 404', async () => {
		const ja = await (await page('/ja')).text()
		expect(ja).toMatch(/<html[^>]* lang="ja-JP"/)
		expect(ja).toMatch(/<meta[^>]*property="og:locale"[^>]*content="ja_JP"/)
		expect(ja).toContain('テーマ：')
		expect(ja).toContain('aria-label="表示言語"')
		const ko = await (await page('/ko/archive')).text()
		expect(ko).toMatch(/<html[^>]* lang="ko-KR"/)
		expect(ko).toContain('테마: ')
		const en = await (await page('/en')).text()
		expect(en).toMatch(/<html[^>]* lang="en-US"/)
		expect(en).toContain('Theme: ')
		expect((await page('/fr')).status).toBe(404)
	})

	it('日文列表：译文的卡片标「AI翻訳」；标签总览与标签页用 core 给的译名，链接照旧按原名；中文列表都没有', async () => {
		const home = await (await page('/ja')).text()
		expect(home).toContain('XSSのサンプル')
		expect(home.match(/class="article-translated"/g)).toHaveLength(1)
		expect(home).toContain('AI翻訳')
		const tags = await (await page('/ja/posts/tag')).text()
		expect(tags).toContain('セキュリティ')
		expect(tags).toContain('href="/ja/posts/tag/security"')
		const tag = await (await page('/ja/posts/tag/security')).text()
		expect(tag).toMatch(/<title>[^<]*セキュリティ/)
		expect(tag.match(/class="article-translated"/g)).toHaveLength(1)
		// 归档（分类、标签页也是同一个条目）：列表紧凑，只放图标；条目上的标签也用译名
		const archive = await (await page('/ja/archive')).text()
		expect(archive.match(/class="article-translated"/g)).toHaveLength(1)
		expect(archive).toMatch(/<li[^>]*>セキュリティ<\/li>/)
		const zh = await (await page('/', { cookie: 'mx-lang=zh' })).text()
		expect(zh).not.toContain('class="article-translated"')
		expect(await (await page('/posts/tag', { cookie: 'mx-lang=zh' })).text()).not.toContain('セキュリティ')
		// 日记列表同样标出
		const notes = await (await page('/ja/notes')).text()
		expect(notes).toContain('週末の本棚整理')
		expect(notes.match(/class="note-translated"/g)).toHaveLength(1)
		expect(await (await page('/notes', { cookie: 'mx-lang=zh' })).text()).not.toContain('class="note-translated"')
	})

	it('日文详情：页脚的标签用译名', async () => {
		const detail = await (await page(`/ja${DETAIL}`)).text()
		expect(detail).toMatch(/<html[^>]* lang="ja-JP"/)
		expect(detail).toContain('セキュリティ')
	})
})

const chrome = chromePath()

describe('译文页解锁加密日记', () => {
	it('解锁带着这一版的语言：日文版按日文取、看原文按 original 取，不再退回中文', async () => {
		const unlock = (query: string) => fetch(`${theme.url}/api/mx/notes/2/unlock${query}`, {
			method: 'POST',
			body: JSON.stringify({ password: 'pw' }),
			headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
		})
		const before = core.requests.length
		expect((await unlock('?lang=ja')).status).toBe(200)
		expect((await unlock('?lang=original')).status).toBe(200)
		const langs = core.requests.slice(before)
			.filter(request => request.path.startsWith('/notes/nid/2?'))
			.map(request => new URL(request.path, 'http://core').searchParams.get('lang'))
		expect(langs).toEqual(['ja', 'original'])
	})
})

describe.skipIf(!chrome)('浏览器', () => {
	let browser: Browser

	beforeAll(async () => {
		browser = await chromium.launch({ executablePath: chrome, headless: true })
	})

	afterAll(async () => {
		await browser?.close()
	})

	async function contextFor(locale: string): Promise<BrowserContext> {
		const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale })
		await context.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
		return context
	}
	const langCookie = async (context: BrowserContext) => (await context.cookies()).find(cookie => cookie.name === 'mx-lang')?.value

	it('日文浏览器进详情页（不跳转）：稍后左下角用日文建议切换；点了去日文版并记下 cookie', async () => {
		const context = await contextFor('ja-JP')
		const tab = await context.newPage()
		await tab.goto(`${theme.url}${DETAIL}`, { waitUntil: 'networkidle' })
		expect(new URL(tab.url()).pathname).toBe(DETAIL)
		const suggestion = tab.getByRole('complementary', { name: 'このサイトは日本語でもご覧いただけます' })
		await suggestion.getByRole('link', { name: '日本語に切り替える' }).click()
		await tab.waitForURL(`**/ja${DETAIL}`)
		// 站内跳转：head 在新页面渲染后更新
		await tab.waitForFunction(() => document.documentElement.lang === 'ja-JP')
		expect(await langCookie(context)).toBe('ja')
		await context.close()
	})

	it('「今はしない」只管这个标签页；「今後表示しない」以后都不再提示这个语言', async () => {
		const context = await contextFor('ja-JP')
		const tab = await context.newPage()
		await tab.goto(`${theme.url}${DETAIL}`)
		const suggestion = tab.getByRole('complementary', { name: /日本語でも/ })
		await suggestion.getByRole('button', { name: '今はしない' }).click()
		await suggestion.waitFor({ state: 'detached' })
		await tab.reload({ waitUntil: 'networkidle' })
		await tab.waitForTimeout(2500)
		expect(await suggestion.count()).toBe(0)

		const other = await context.newPage()
		await other.goto(`${theme.url}${DETAIL}`)
		const again = other.getByRole('complementary', { name: /日本語でも/ })
		await again.getByRole('button', { name: '今後表示しない' }).click()
		await again.waitFor({ state: 'detached' })
		const third = await context.newPage()
		await third.goto(`${theme.url}${DETAIL}`, { waitUntil: 'networkidle' })
		await third.waitForTimeout(2500)
		expect(await third.getByRole('complementary', { name: /日本語でも/ }).count()).toBe(0)
		expect(await langCookie(context)).toBeUndefined()
		await context.close()
	})

	it('日文浏览器进首页被跳到 /ja；侧栏的界面语言切换列出中文、English、日本語、한국어，选中文回来后不再跳', async () => {
		const context = await contextFor('ja-JP')
		const tab = await context.newPage()
		await tab.goto(`${theme.url}/`, { waitUntil: 'networkidle' })
		expect(new URL(tab.url()).pathname).toBe('/ja')
		const nav = tab.locator('#blog-sidebar').getByRole('navigation', { name: '表示言語' })
		expect(await nav.getByRole('link').allTextContents()).toEqual(['中文', 'English', '日本語', '한국어'])
		expect(await nav.getByRole('link', { name: '日本語' }).getAttribute('aria-current')).toBe('true')
		await nav.getByRole('link', { name: '中文' }).click()
		await tab.waitForURL(url => new URL(url).pathname === '/')
		await tab.locator('#blog-sidebar').getByRole('navigation', { name: '界面语言' }).waitFor()
		await tab.waitForFunction(() => document.documentElement.lang === 'zh-CN')
		expect(await langCookie(context)).toBe('zh')
		await tab.reload({ waitUntil: 'networkidle' })
		expect(new URL(tab.url()).pathname).toBe('/')
		await context.close()
	})
})
