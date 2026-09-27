/**
 * 订阅、AI 精读、朗读、站长「此刻」、实时连接（新评论、阅读位置、新发布、页脚的正在阅读）、划词评论、多语言。
 * 用一篇真实形状的 Lexical 文章（夹具 post-lexical-lists，带 core 写的块 id）
 */
import type { Browser, BrowserContext } from 'playwright-core'
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { readFileSync } from 'node:fs'
import { chromium, devices } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const POST_ID = '186000000000000101'
/** 刚发布、主题缓存的时间线里还没有的一篇（游客按 id 取得到） */
const FRESH_ID = '186000000000000777'
const PATH = '/posts/tools/sample-list-code'
const BLOCK = 'twbEKUdO'
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))

/** 这篇有英文译文；按 ?lang=en 取时正文换成译文 */
function lexicalPost(lang: string | null) {
	const post = fixture('post-lexical-lists')
	post.meta = {
		...post.meta,
		insights: { has_in_locale: true },
		tts: { available: true, stale: true },
		translation: { [POST_ID]: { article: { is_translated: lang === 'en', source_lang: 'zh', target_lang: lang ?? 'zh', available_translations: ['en', 'ja'] } } },
	}
	if (lang === 'en')
		post.data.title = 'Code blocks inside a list'
	return post
}

function comment(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		ref_type: 'post',
		ref_id: POST_ID,
		author: '读者',
		url: null,
		text: '说得对',
		state: 1,
		parent_comment_id: null,
		root_comment_id: null,
		reply_count: 0,
		is_deleted: false,
		pin: false,
		is_whispers: false,
		avatar: null,
		reader_id: null,
		anchor: null,
		mail: 'reader@example.test',
		created_at: '2026-09-25T00:00:00.000Z',
		replies: [],
		...extra,
	}
}

/** WS 推的评论是 camelCase（core 的 payload 不做 snake_case） */
function wsComment(id: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		refType: 'post',
		refId: POST_ID,
		author: '读者',
		text: '说得对',
		state: 0,
		parentCommentId: null,
		rootCommentId: null,
		isDeleted: false,
		pin: false,
		isWhispers: false,
		avatar: null,
		readerId: null,
		mail: 'reader@example.test',
		createdAt: '2026-09-25T00:00:00.000Z',
		...extra,
	}
}

const ANCHORED = comment('190000000000000001', { anchor: { mode: 'range', block_id: BLOCK, quote: '反引号', prefix: '也可以出现', suffix: ' ` 这样', start_offset: 29, end_offset: 32 } })
const STALE = comment('190000000000000002', { anchor: { mode: 'range', block_id: BLOCK, quote: '后来删掉的一句', prefix: '', suffix: '', start_offset: 0, end_offset: 7 } })
/** 段落评论（mode=block） */
const BLOCK_COMMENT = comment('190000000000000003', { text: '这一段写得好', anchor: { mode: 'block', block_id: 'vUAJwEYH', block_type: 'heading', snapshot_text: '开始之前' } })

const DESK = {
	epoch: 'e1',
	revision: 1,
	projection: {
		availability: 'active',
		expiresAt: '2999-01-01T00:00:00.000Z',
		application: { displayName: 'VS Code', window: { title: 'secret-project.ts' }, icon: { url: 'https://tracker.example.test/icon.png' } },
		media: {
			kind: 'music',
			title: '一首歌',
			artist: '某人',
			artwork: { url: `https://tracker.example.test/cover.png?v=${'a'.repeat(64)}` },
			link: { url: 'https://music.163.com/song?id=186016' },
			playback: { state: 'playing', durationMs: 200_000, positionMs: 10_000, anchorAt: new Date().toISOString(), rate: 1 },
		},
	},
}

/** core 当前的「此刻」；测试里换成新版本再推送 */
let deskState: typeof DESK = DESK

function handle(request: CoreRequest): CoreReply | undefined {
	const url = new URL(request.path, 'http://core')
	const path = url.pathname
	if (path === PATH || path === `/posts/${POST_ID}`)
		return { body: lexicalPost(url.searchParams.get('lang')) }
	if (path === `/posts/${FRESH_ID}`) {
		const fresh = lexicalPost(null)
		fresh.data.id = FRESH_ID
		return { body: fresh }
	}
	if (path === `/comments/guest/${FRESH_ID}` && request.method === 'POST')
		return { body: { data: comment('190000000000000098', { ref_id: FRESH_ID, text: JSON.parse(request.body || '{}').text }) } }
	if (path === '/subscribe/status')
		return { body: { data: { enable: true, allow_types: ['post_c', 'note_c', 'say_c'] } } }
	if (path === '/subscribe' && request.method === 'POST')
		return { status: 204 }
	if (path === `/ai/insights/article/${POST_ID}`)
		return { body: { data: { content: '要点在这里<ref quote="普通文字里也可以出现反引号" section="开头"/>。\n\n<!-- insights-meta: {"reading_time_min": 3} -->', is_translation: false } } }
	if (path === `/ai/tts/article/${POST_ID}`)
		return { body: { data: { model: 'secret-model', voice: 'secret-voice', segments: [{ text: '第一段', url: 'https://cdn.example.test/1.mp3', block_id: BLOCK }, { text: '坏的', url: 'javascript:alert(1)' }] } } }
	if (path === '/companion/presence/public')
		return { body: { data: { state: deskState } } }
	if (path === '/fn/shiro/status')
		return { body: { emoji: '☕', desc: '在喝咖啡' } }
	if (path === '/activity/presence')
		return { body: { data: { presence: { 'other-1': { identity: 'other-1', roomName: `article-${POST_ID}`, position: 40, displayName: '小红', sid: 'secret-sid-of-other' } }, readers: {} } } }
	if (path === '/activity/presence/update')
		return { body: { data: { ok: true } } }
	if (path === `/comments/guest/${POST_ID}` && request.method === 'POST') {
		const body = JSON.parse(request.body || '{}')
		return { body: { data: comment('190000000000000099', { text: body.text, anchor: body.anchor ?? null }) } }
	}
	if (path === `/comments/ref/${POST_ID}`)
		return { body: { data: { data: [ANCHORED, STALE, BLOCK_COMMENT], meta: { pagination: { page: 1, size: 10, total: 3, total_pages: 1 } } } } }
	return undefined
}

let core: FakeCore
let theme: ThemeServer

beforeAll(async () => {
	core = await startFakeCore({
		theme: { timeZone: 'Asia/Shanghai', liveDesk: { enable: true }, ownerStatus: { fn: 'shiro/status' }, i18n: { languages: ['en'] } },
		handle,
	})
	theme = await startTheme(core.apiUrl)
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

const get = (path: string, init?: RequestInit) => fetch(`${theme.url}${path}`, init)
const coreCalls = (pattern: RegExp) => core.requests.filter(request => pattern.test(request.path))

async function until<T>(check: () => T | undefined | false, what: string, ms = 5000): Promise<T> {
	const deadline = Date.now() + ms
	for (;;) {
		const value = check()
		if (value)
			return value
		if (Date.now() > deadline)
			throw new Error(`等不到：${what}`)
		await new Promise(resolve => setTimeout(resolve, 50))
	}
}

describe('订阅、精读、朗读、此刻', () => {
	it('精读只读库里的（onlyDb），引用换成跳回原文的元素', async () => {
		const insights = await (await get(`/api/mx/insights/${POST_ID}`)).json()
		expect(insights).toMatchObject({ status: 'ready', meta: { readingMinutes: 3 } })
		expect(JSON.stringify(insights.body)).toContain('"tag":"insight-ref"')
		const [call] = coreCalls(/^\/ai\/insights\//)
		expect(call!.path).toMatch(/only_?db=true/i)
		expect(coreCalls(/generate/)).toEqual([])
	})

	it('详情带着精读与朗读的入口（朗读版本旧了也说）', async () => {
		const detail = await (await get(`/api/mx${PATH}`)).json()
		expect(detail.extras).toMatchObject({ insights: true, tts: { stale: true } })
	})

	it('站长「此刻」：窗口标题默认不给；图标与封面换成签好名的本站转发地址；带进度与歌曲链接；站长状态取自配的云函数', async () => {
		const desk = await (await get('/api/mx/live-desk')).json()
		expect(desk).toMatchObject({ app: { name: 'VS Code' }, media: { title: '一首歌', artist: '某人', playing: true, durationMs: 200_000, link: 'https://music.163.com/song?id=186016' } })
		expect(desk.media.positionMs).toBeGreaterThanOrEqual(10_000)
		expect(JSON.stringify(desk)).not.toContain('secret-project')
		for (const image of [desk.app.icon, desk.media.artwork])
			expect(image).toMatch(/^\/api\/mx\/live-desk\/image\?u=https%3A%2F%2Ftracker\.example\.test%2F[^&]+&s=[\w-]+$/)
		// 签名不对、换了地址的一律 404，不会替人去取任意网址
		const icon = new URL(desk.app.icon, 'http://x')
		expect((await get(`/api/mx/live-desk/image?u=${encodeURIComponent('https://evil.example.test/a.png')}&s=${icon.searchParams.get('s')}`)).status).toBe(404)
		expect((await get(`/api/mx/live-desk/image?u=${encodeURIComponent(icon.searchParams.get('u')!)}&s=wrong`)).status).toBe(404)
		expect(await (await get('/api/mx/owner-status')).json()).toMatchObject({ emoji: '☕', desc: '在喝咖啡' })
	})
})

describe('划词评论', () => {
	it('正文块由本站按匿名正文算：刚发布、时间线缓存里还没有的文章按 id 取得到也给；取不到的（草稿、日记 id）是 null', async () => {
		const { blocks } = await (await get(`/api/mx/anchor-blocks/${POST_ID}`)).json()
		expect(blocks[BLOCK]).toMatchObject({ type: 'paragraph', text: expect.stringMatching(/^这篇示例演示/) })
		expect((await (await get(`/api/mx/anchor-blocks/${FRESH_ID}`)).json()).blocks[BLOCK]).toBeTruthy()
		expect(await (await get('/api/mx/anchor-blocks/186000000000000778')).json()).toEqual({ blocks: null })
	})

	it('正文块只缓存取到了的：不存在的 id 每次都问 core、带上访客 IP（限流落在刷的人身上）；取到了的缓存期内不再问', async () => {
		const missing = '186000000000000779'
		const asked = (id: string) => core.requests.filter(request => request.path.split('?')[0] === `/posts/${id}`)
		await get(`/api/mx/anchor-blocks/${missing}`)
		await get(`/api/mx/anchor-blocks/${missing}`)
		expect(asked(missing)).toHaveLength(2)
		expect(asked(missing).every(request => request.headers['x-forwarded-for'])).toBe(true)
		await get(`/api/mx/anchor-blocks/${FRESH_ID}`)
		const afterFirst = asked(FRESH_ID).length
		await get(`/api/mx/anchor-blocks/${FRESH_ID}`)
		expect(asked(FRESH_ID)).toHaveLength(afterFirst)
	})

	it('正文里的段落带着 core 的块 id', async () => {
		const html = await (await get(PATH)).text()
		expect(html).toContain(`data-block-id="${BLOCK}"`)
	})
})

describe('多语言', () => {
	it('前缀版取对应语言：有译文就渲染，带 hreflang、正文标 lang；没开的语言 404', async () => {
		core.requests.length = 0
		const res = await get(`/en${PATH}`, { redirect: 'manual' })
		expect(res.status).toBe(200)
		const html = await res.text()
		expect(html).toContain('Code blocks inside a list')
		expect(html).toMatch(/hreflang="en"[^>]*href="[^"]*\/en\/posts\/tools\/sample-list-code"|href="[^"]*\/en\/posts\/tools\/sample-list-code"[^>]*hreflang="en"/)
		expect(html).toContain('hreflang="zh-CN"')
		expect(html).toContain('hreflang="x-default"')
		// ja 有译文但主题配置没开：不列
		expect(html).not.toContain('hreflang="ja"')
		expect(html).toMatch(/<article[^>]*lang="en"/)
		expect(coreCalls(new RegExp(`^${PATH}\\?.*lang=en`)).length).toBeGreaterThan(0)
		expect((await get(`/ja${PATH}`, { redirect: 'manual' })).status).toBe(404)
	})

	it('这一语言没有译文：留在前缀地址（英文界面）显示原文与说明，noindex，canonical 指向原文地址；看原文走 ?lang=original', async () => {
		const res = await get('/en/notes/2', { redirect: 'manual' })
		expect(res.status).toBe(200)
		const html = await res.text()
		expect(html).toMatch(/<html[^>]* lang="en-US"/)
		expect(html).toContain('hasn&#39;t been translated into English yet')
		expect(html).toMatch(/<meta name="robots" content="noindex, follow"/)
		expect(html).toMatch(/<link rel="canonical" href="[^"]*\/notes\/2"/)
		core.requests.length = 0
		await get(`${PATH}?lang=original`)
		expect(coreCalls(new RegExp(`^${PATH}\\?.*lang=original`)).length).toBeGreaterThan(0)
	})

	it('列表的前缀版 noindex；接口里白名单外的语言按站点语言取', async () => {
		const home = await (await get('/en')).text()
		expect(home).toMatch(/<meta name="robots" content="noindex, follow"/)
		// 白名单外的语言与不带语言的是同一份（同一个缓存），core 那边看不到这个值
		core.requests.length = 0
		const [odd, plain] = await Promise.all([get('/api/mx/timeline?lang=xx').then(res => res.text()), get('/api/mx/timeline').then(res => res.text())])
		expect(odd).toBe(plain)
		expect(core.requests.some(request => request.path.includes('lang=xx'))).toBe(false)
	})
})

const chrome = chromePath()

describe.skipIf(!chrome)('浏览器', () => {
	let browser: Browser
	let context: BrowserContext

	beforeAll(async () => {
		browser = await chromium.launch({ executablePath: chrome, headless: true })
		// 站点开了英文：浏览器语言用中文，免得语言建议条冒出来
		context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'zh-CN' })
		await context.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
	})

	afterAll(async () => {
		await browser?.close()
	})

	it('朗读：点了才由浏览器向 core 取分段，前缀版按那个语言取', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}/en${PATH}`, { waitUntil: 'networkidle' })
		core.requests.length = 0
		await page.getByRole('button', { name: 'Read aloud' }).click()
		await expect.poll(() => coreCalls(/^\/ai\/tts\//).length).toBeGreaterThan(0)
		const [call] = coreCalls(/^\/ai\/tts\//)
		expect(new URL(call!.path, 'http://x').searchParams.get('lang')).toBe('en')
		expect(String(call!.headers['user-agent'])).toMatch(/Chrome/)
		await page.close()
	})

	it('邮件订阅：正文后面点赞旁的「订阅」打开订阅框，只给文章与日记、默认勾当前这一类，页脚的「邮件订阅」全勾；浏览器直连 core，邮箱转成小写', async () => {
		core.requests.length = 0
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.locator('.post-actions').getByRole('button', { name: '订阅' }).click()
		const dialog = page.getByRole('dialog', { name: '邮件订阅' })
		// 在视口正中（全局重置清掉了原生对话框居中用的外边距）
		const box = (await dialog.boundingBox())!
		expect([Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)]).toEqual([700, 500])
		expect(await dialog.getByRole('checkbox').count()).toBe(2)
		expect([await dialog.getByLabel('新文章').isChecked(), await dialog.getByLabel('新日记').isChecked()]).toEqual([true, false])
		await dialog.getByRole('textbox').fill('A@example.test')
		await dialog.getByRole('button', { name: '订阅' }).click()
		await dialog.getByText(/订阅好了/).waitFor()
		const [sent] = coreCalls(/^\/subscribe(?:\?|$)/).filter(request => request.method === 'POST')
		expect(JSON.parse(sent!.body)).toEqual({ email: 'a@example.test', types: ['post_c'] })
		expect(String(sent!.headers['user-agent'])).toMatch(/Chrome/)
		// 日记后面的默认勾「新日记」；页脚的「邮件订阅」两类都勾
		await page.goto(`${theme.url}/notes/2`, { waitUntil: 'networkidle' })
		await page.locator('.post-actions').getByRole('button', { name: '订阅' }).click()
		expect([await dialog.getByLabel('新文章').isChecked(), await dialog.getByLabel('新日记').isChecked()]).toEqual([false, true])
		await dialog.getByRole('button', { name: '关闭' }).click()
		await page.locator('.blog-footer').getByRole('button', { name: '邮件订阅' }).click()
		expect([await dialog.getByLabel('新文章').isChecked(), await dialog.getByLabel('新日记').isChecked()]).toEqual([true, true])
		await page.close()
	})

	it('鼠标移到页脚的在线人数上，弹出此刻在读的内容，移开收起；弹出时才去取', async () => {
		// 前面的用例进过 /en，记下了语言 cookie，列表页会被跳到英文版
		await context.clearCookies()
		const before = core.wsConnections.length
		const page = await context.newPage()
		const board: string[] = []
		page.on('request', request => new URL(request.url()).pathname === '/api/mx/reading' && board.push(request.url()))
		await page.goto(`${theme.url}/says`, { waitUntil: 'networkidle' })
		await until(() => core.wsConnections.slice(before).find(item => item.url.startsWith('/ws/web?')), '连上 core')
		core.broadcast({ v: 1, event: 'visitor.online', payload: { online: 3 } })
		const toggle = page.locator('.footer-online > button')
		await toggle.getByText('当前 3 人在线').waitFor()
		expect(board).toEqual([])
		await toggle.hover()
		const popover = page.locator('.footer-reading')
		await popover.getByRole('link', { name: '周末整理书架' }).waitFor()
		expect(board.length).toBeGreaterThan(0)
		expect(await toggle.getAttribute('aria-expanded')).toBe('true')
		await page.mouse.move(0, 0)
		await popover.waitFor({ state: 'detached' })
		await page.close()
	})

	it('选中正文里的一段 → 「评论这段」→ 评论框顶上显示引用', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.evaluate((blockId) => {
			const block = document.querySelector(`[data-block-id="${blockId}"]`)!
			const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
			const text = walker.nextNode() as Text
			const at = text.data.indexOf('普通文字')
			const range = document.createRange()
			range.setStart(text, at)
			range.setEnd(text, at + 4)
			getSelection()!.removeAllRanges()
			getSelection()!.addRange(range)
		}, BLOCK)
		await page.getByRole('button', { name: '评论这段' }).click()
		await page.locator('.comment-form-quote').getByText('普通文字').waitFor()
		// 以游客身份发出去：浏览器按本站给的正文块重建锚点（偏移、前后文按正文算），不带 cookie
		core.requests.length = 0
		const form = page.locator('form.comment-form').first()
		await form.getByLabel('昵称').fill('读者')
		await form.getByLabel('邮箱，不会公开').fill('reader@example.test')
		await form.getByLabel('评论内容').fill('好')
		await form.getByRole('button', { name: '发送' }).click()
		await expect.poll(() => coreCalls(new RegExp(`^/comments/guest/${POST_ID}`)).length).toBe(1)
		const [sent] = coreCalls(new RegExp(`^/comments/guest/${POST_ID}`))
		const { blocks } = await (await get(`/api/mx/anchor-blocks/${POST_ID}`)).json()
		const start = blocks[BLOCK].text.indexOf('普通文字')
		expect(JSON.parse(sent!.body).anchor).toMatchObject({ mode: 'range', blockId: BLOCK, quote: '普通文字', prefix: blocks[BLOCK].text.slice(Math.max(0, start - 50), start), startOffset: start, endOffset: start + 4 })
		expect(sent!.headers.cookie).toBeUndefined()
		await page.close()
	})

	it('浮条有「复制」；跨块的选区是「引用评论」，把 > 引用预填进评论框', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.evaluate(() => {
			const textIn = (el: Element, needle: string) => {
				const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
				for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
					if (node.data.includes(needle))
						return node
				}
				throw new Error(`没找到 ${needle}`)
			}
			const blocks = document.querySelectorAll('#main-content article.article [data-block-id]')
			const start = textIn(blocks[0]!, '开始之前')
			const end = textIn(blocks[1]!, '这篇示例')
			const range = document.createRange()
			range.setStart(start, start.data.indexOf('开始之前'))
			range.setEnd(end, end.data.indexOf('这篇示例') + 4)
			getSelection()!.removeAllRanges()
			getSelection()!.addRange(range)
		})
		const bar = page.getByRole('toolbar', { name: '选中的文字' })
		await bar.getByRole('button', { name: '复制' }).waitFor()
		await bar.getByRole('button', { name: '引用评论' }).click()
		await expect.poll(() => page.getByLabel('评论内容').first().inputValue()).toMatch(/^> 开始之前/)
		await page.close()
	})

	it('鼠标停在正文的下划线上：手形光标，弹出这一段评论的预览；点下去打开这一段的讨论（预览收起）；段落边栏打开段落的讨论', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		// 下划线画好了：找到「反引号」在页面上的位置点一下
		const point = await page.evaluate(async (blockId) => {
			for (let i = 0; i < 50 && !(globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.has('mx-comment'); i++)
				await new Promise(resolve => setTimeout(resolve, 100))
			const block = document.querySelector(`[data-block-id="${blockId}"]`)!
			const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
			let text = walker.nextNode() as Text
			while (!text.data.includes('反引号'))
				text = walker.nextNode() as Text
			const at = text.data.indexOf('反引号')
			const range = document.createRange()
			range.setStart(text, at)
			range.setEnd(text, at + 3)
			block.scrollIntoView({ block: 'center' })
			const rect = range.getBoundingClientRect()
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
		}, BLOCK)
		await page.mouse.move(point.x - 1, point.y)
		await page.mouse.move(point.x, point.y)
		const preview = page.getByRole('tooltip')
		await preview.getByText('说得对').waitFor()
		await preview.getByText('点划线处看完整讨论、回复').waitFor()
		expect(await page.locator('#main-content article.article').evaluate(el => (el as HTMLElement).style.cursor)).toBe('pointer')
		await page.mouse.click(point.x, point.y)
		const panel = page.getByRole('dialog', { name: '这一段的讨论' })
		await panel.getByText('说得对').waitFor()
		expect(await preview.count()).toBe(0)
		await panel.getByLabel('评论内容').waitFor()
		await page.keyboard.press('Escape')
		await panel.waitFor({ state: 'detached' })
		// 段落边栏：有段落评论的标题旁常驻一个计数
		await page.getByRole('button', { name: /这一段有 1 条评论/ }).first().click()
		await panel.getByText('这一段写得好').waitFor()
		await page.close()
	})

	it('手机上：点下划线打开贴底的讨论抽屉，抽屉在最上层（右下角的浮动按钮压不住评论框的「发送」）', async () => {
		const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-CN' })
		await phone.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
		const page = await phone.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const point = await page.evaluate(async (blockId) => {
			for (let i = 0; i < 50 && !(globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights?.has('mx-comment'); i++)
				await new Promise(resolve => setTimeout(resolve, 100))
			const block = document.querySelector(`[data-block-id="${blockId}"]`)!
			const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
			let text = walker.nextNode() as Text
			while (!text.data.includes('反引号'))
				text = walker.nextNode() as Text
			const at = text.data.indexOf('反引号')
			const range = document.createRange()
			range.setStart(text, at)
			range.setEnd(text, at + 3)
			block.scrollIntoView({ block: 'center' })
			const rect = range.getBoundingClientRect()
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
		}, BLOCK)
		await page.touchscreen.tap(point.x, point.y)
		const panel = page.getByRole('dialog', { name: '这一段的讨论' })
		await panel.getByText('说得对').waitFor()
		const box = (await panel.boundingBox())!
		const viewport = page.viewportSize()!
		// 贴底、占满宽度
		expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 1)
		expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1)
		const send = panel.getByRole('button', { name: '发送' })
		await send.scrollIntoViewIfNeeded()
		const target = (await send.boundingBox())!
		expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="dialog"]'), { x: target.x + target.width / 2, y: target.y + target.height / 2 })).toBe(true)
		await phone.close()
	})

	it('实时连接直连 core 的 /ws/web：进房间等 core 确认后才报位置，位置直接报给 core，不带 cookie，标识不是会话 id', async () => {
		core.requests.length = 0
		const before = core.wsConnections.length
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		const connection = await until(() => core.wsConnections.slice(before).find(item => item.url.startsWith('/ws/web?')), '连上 core')
		const sid = new URL(connection.url, 'http://x').searchParams.get('socket_session_id')
		await until(() => core.wsFrames.map(raw => JSON.parse(raw)).find(frame => frame.event === 'room.join' && frame.payload?.room === `article-${POST_ID}`), '进房间')
		await page.mouse.wheel(0, 600)
		const report = await until(() => coreCalls(/^\/activity\/presence\/update/)[0], '报位置', 10_000)
		const body = JSON.parse(report.body)
		expect(body).toMatchObject({ sid, roomName: `article-${POST_ID}` })
		expect(body.identity).toMatch(/^[\da-f]{24}$/)
		expect(body.identity).not.toBe(sid)
		expect(report.headers.cookie).toBeUndefined()
		await page.close()
	})

	it('站长「此刻」收到新版本的推送：去本站取映射好、图片签好名的那份，侧栏跟着换', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.locator('.live-desk').getByText('在用 VS Code').waitFor()
		deskState = { ...DESK, revision: 2, projection: { ...DESK.projection, application: { ...DESK.projection.application, displayName: 'Zed' } } }
		core.broadcast({ v: 1, event: 'companion_presence.changed', payload: deskState })
		await page.locator('.live-desk').getByText('在用 Zed').waitFor()
		deskState = DESK
		await page.close()
	})

	it('别人刚发的评论实时插进来并标「新」；别人的位置画在正文旁', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.locator('#comments').scrollIntoViewIfNeeded()
		await page.getByText('说得对').first().waitFor()
		// 在读列表里的小红
		const dot = page.locator('.presence-dot[aria-label="小红 · 40%"]')
		await dot.hover()
		await dot.getByText('小红 · 40%').waitFor()
		await page.waitForTimeout(300)
		core.broadcast({ v: 1, event: 'comment.create', payload: wsComment('190000000000000060', { text: '刚刚发的' }) })
		await page.getByText('刚刚发的').waitFor()
		await page.locator('.comment-badge', { hasText: '新' }).waitFor()
		await page.close()
	})

	it('评论被改就地换正文；这一篇被删掉后正文换成说明', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}${PATH}`, { waitUntil: 'networkidle' })
		await page.locator('#comments').scrollIntoViewIfNeeded()
		await page.getByText('说得对').first().waitFor()
		await page.locator('.presence-dot').first().waitFor()
		core.broadcast({ v: 1, event: 'comment.update', payload: { id: '190000000000000001', text: '作者后来改成了这样' } })
		await page.getByText('作者后来改成了这样').waitFor()
		core.broadcast({ v: 1, event: 'post.delete', payload: POST_ID })
		await page.getByText('这篇已删除或下线').waitFor()
		expect(await page.locator('article.article').count()).toBe(0)
		await page.close()
	})

	it('前缀版：英文界面，语言切换列出原文与英文，站内链接保持语言', async () => {
		const page = await context.newPage()
		await page.goto(`${theme.url}/en${PATH}`, { waitUntil: 'networkidle' })
		// 内容的语言版本（侧栏另有「Interface language」，要精确匹配）
		const nav = page.getByRole('navigation', { name: 'Language', exact: true })
		await nav.getByText('English').waitFor()
		await nav.getByRole('link', { name: /中文 \(original\)/ }).waitFor()
		expect(await page.getAttribute('html', 'lang')).toBe('en-US')
		expect(await page.locator('#blog-sidebar a[href="/en"]').count()).toBeGreaterThan(0)
		await page.close()
	})
})
