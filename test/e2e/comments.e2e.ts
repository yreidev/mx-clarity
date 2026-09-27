/**
 * 评论与账号的功能：排序、按 id 定位、编辑、举报、我的评论、登录回来、会员页的账号区块。
 * 假 core 按 cookie 认身份：`better-auth.session_token=reader` 是读者，`=owner` 是站长
 */
import type { Browser, BrowserContext } from 'playwright-core'
import type { CoreReply, CoreRequest, FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { chromePath, startTheme } from './harness'

const POST_ID = '183590000000000002'
const POST_PATH = '/posts/tech/mx-syntax-sample'
const READER_ID = 'reader-id-184000000000000777'
/** 读者自己刚发的一条（在可编辑时间内） */
const OWN_ID = '184900000000000701'
/** 不在第一页、要单独定位的一条 */
const FAR_ID = '184900000000000555'
/** 另一位登录读者的评论（能被屏蔽） */
const OTHER_READER_ID = '184900000000000702'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))
const reply = (body: unknown, status = 200): CoreReply => ({ status, body })
const notFound = () => reply({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404)

function wire(over: Record<string, unknown>) {
	return { ...fixture('comments-ref').data.data[1], replies: [], reply_window: undefined, ...over }
}

function identityOf(request: CoreRequest) {
	const cookie = String(request.headers.cookie ?? '')
	return cookie.includes('session_token=owner') ? 'owner' : cookie.includes('session_token=reader') ? 'reader' : undefined
}

let createdAt = new Date().toISOString()

function handle(request: CoreRequest): CoreReply | undefined {
	const [path = '', query = ''] = request.path.split('?')
	const params = new URLSearchParams(query)
	if (path === '/auth/session') {
		const who = identityOf(request)
		return reply({ data: who ? { id: who === 'owner' ? 'owner-id' : READER_ID, name: who === 'owner' ? '站长' : '读者甲', role: who } : null })
	}
	if (path === '/auth/providers')
		return reply({ data: ['github'] })
	if (path.startsWith('/comments/ref/')) {
		const list = fixture('comments-ref')
		// 定位：around 指到远处那条时，core 给的是它所在的那一页
		if (params.get('around') === FAR_ID) {
			list.data.data = [wire({ id: FAR_ID, ref_id: POST_ID, author: '远处的评论', text: '在后面几页' })]
		}
		else {
			list.data.data.unshift(wire({ id: OWN_ID, ref_id: POST_ID, author: '读者甲', text: '我自己的评论', reader_id: READER_ID, created_at: createdAt }))
			list.data.data.push(wire({ id: OTHER_READER_ID, ref_id: POST_ID, author: '读者乙', text: '另一位读者的评论', reader_id: 'reader-id-b' }))
		}
		return reply(list)
	}
	if (path === `/comments/${OWN_ID}`)
		return reply({ data: wire({ id: OWN_ID, ref_id: POST_ID, reader_id: READER_ID, created_at: createdAt, state: 1 }) })
	if (path === `/comments/${FAR_ID}`)
		return reply({ data: wire({ id: FAR_ID, ref_id: POST_ID, root_comment_id: null, state: 1 }) })
	if (path === `/comments/${OTHER_READER_ID}` && identityOf(request) === 'owner')
		return reply({ data: wire({ id: OTHER_READER_ID, text: '另一位读者的**原文**' }) })
	if (/^\/comments\/\d+$/.test(path) && request.method === 'GET')
		return notFound()
	if (/^\/comments\/\d+\/report$/.test(path))
		return reply({ data: { ok: true } })
	if (/^\/comments\/\d+\/report-and-block$/.test(path)) {
		if (identityOf(request) !== 'reader')
			return reply({ error: { code: 'AUTH_NOT_LOGGED_IN', message: 'x' } }, 401)
		return path.includes(OWN_ID) ? reply({ error: { code: 'INVALID_PARAMETER', message: 'x' } }, 400) : reply({ data: { ok: true, blocked_reader_id: 'reader-id-b' } })
	}
	// 站长：置顶（PATCH /comments/:id）与取原文（GET /comments/:id 带站长会话）
	if (/^\/comments\/\d+$/.test(path) && request.method === 'PATCH')
		return identityOf(request) === 'owner' ? reply({ data: {} }) : reply({ error: { code: 'AUTH_NOT_LOGGED_IN', message: 'x' } }, 401)
	if (path === '/fn/shiro/status') {
		if (request.method === 'GET')
			return reply({ emoji: '☕', desc: '在喝咖啡' })
		return identityOf(request) === 'owner' ? reply({ data: { ok: true } }) : reply({ error: { code: 'AUTH_NOT_LOGGED_IN', message: 'x' } }, 401)
	}
	if (path.startsWith('/comments/edit/'))
		return { status: 204 }
	if (path === '/comments/reader/me') {
		return reply({ data: { data: [
			{ id: OWN_ID, ref_id: POST_ID, ref_type: 'posts', source: { category_slug: 'tech', slug: 'mx-syntax-sample' }, source_title: '语法示例', text: '我自己的评论', created_at: createdAt },
		], meta: { pagination: { page: 1, total: 1, total_pages: 1 } } } })
	}
	if (path === '/membership/plans')
		return reply(fixture('membership-plans'))
	if (path === '/membership/status')
		return reply(fixture('membership-status'))
	if (path === '/membership/archive')
		return reply(fixture('membership-archive'))
	return undefined
}

let core: FakeCore
let theme: ThemeServer

beforeAll(async () => {
	core = await startFakeCore({ theme: { timeZone: 'Asia/Shanghai', ownerStatus: { fn: 'shiro/status' } }, handle })
	theme = await startTheme(core.apiUrl)
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

const coreCalls = (pattern: RegExp) => core.requests.filter(request => pattern.test(request.path))

const chrome = chromePath()

describe.skipIf(!chrome)('浏览器里的评论区', () => {
	let browser: Browser
	let context: BrowserContext

	beforeAll(async () => {
		browser = await chromium.launch({ executablePath: chrome, headless: true })
		context = await browser.newContext()
		await context.route('**/*', route => route.request().url().startsWith(theme.url) ? route.continue() : route.abort())
	})

	afterAll(async () => {
		await browser?.close()
	})

	async function open(path: string, cookie?: string) {
		await context.clearCookies()
		if (cookie)
			await context.addCookies([{ name: 'better-auth.session_token', value: cookie, url: theme.url }])
		const page = await context.newPage()
		const errors: string[] = []
		page.on('pageerror', error => errors.push(error.message))
		await page.goto(`${theme.url}${path}`, { waitUntil: 'networkidle' })
		return { page, errors }
	}

	it('带 #comment-<id> 打开：加载评论区并高亮那一条；不在第一页的单独取来放在最上面', async () => {
		const { page, errors } = await open(`${POST_PATH}#comment-184843629800460288`)
		await page.locator('#comment-184843629800460288.highlighted').waitFor()
		await page.close()

		const far = await open(`${POST_PATH}#comment-${FAR_ID}`)
		await far.page.locator(`#comment-${FAR_ID}.highlighted`).waitFor()
		expect(await far.page.locator('.comment-list > .comment-item').first().getAttribute('id')).toBe(`comment-${FAR_ID}`)
		await far.page.close()

		const missing = await open(`${POST_PATH}#comment-184900000000000999`)
		await missing.page.getByText('要找的评论不存在，或者还没有公开').waitFor()
		await missing.page.close()
		expect([...errors, ...far.errors, ...missing.errors]).toEqual([])
	})

	it('排序切换：点「最新」重新加载，请求带 sort=newest', async () => {
		const { page } = await open(`${POST_PATH}#comments`)
		await page.locator('#comments').scrollIntoViewIfNeeded()
		await page.locator('.comment-list').waitFor()
		core.requests.length = 0
		await page.getByRole('button', { name: '最新' }).click()
		await expect.poll(() => coreCalls(/^\/comments\/ref\/.*sort=newest/).length).toBeGreaterThan(0)
		expect(await page.getByRole('button', { name: '最新' }).getAttribute('aria-pressed')).toBe('true')
		await page.close()
	})

	it('表情面板：点了插在光标处', async () => {
		const { page } = await open(`${POST_PATH}#comments`)
		await page.locator('#comments').scrollIntoViewIfNeeded()
		const textarea = page.getByLabel('评论内容').first()
		await textarea.fill('你好')
		await page.getByRole('button', { name: '表情', exact: true }).first().click()
		await page.getByRole('button', { name: '插入 👍' }).click()
		expect(await textarea.inputValue()).toBe('你好👍')
		await page.close()
	})

	it('自己的评论能改，改完显示新正文与「已编辑」；别人的能举报', async () => {
		createdAt = new Date().toISOString()
		const { page, errors } = await open(`${POST_PATH}#comments`, 'reader')
		await page.locator('#comments').scrollIntoViewIfNeeded()
		const own = page.locator(`#comment-${OWN_ID}`)
		await own.getByRole('button', { name: '编辑' }).click()
		const editor = own.getByLabel('修改评论')
		expect(await editor.inputValue()).toBe('我自己的评论')
		await editor.fill('改过的评论')
		await own.getByRole('button', { name: '保存' }).click()
		await own.getByText('改过的评论').waitFor()
		await own.getByText('已编辑').waitFor()
		// 浏览器直连 core：编辑带着读者的 cookie
		const [patch] = coreCalls(new RegExp(`^/comments/edit/${OWN_ID}`))
		expect(JSON.parse(patch!.body)).toEqual({ text: '改过的评论' })
		expect(String(patch!.headers.cookie)).toContain('better-auth.session_token=reader')
		// 自己的没有举报，别人的有
		expect(await own.getByRole('button', { name: '举报' }).count()).toBe(0)
		const other = page.locator('#comment-184843629691408384')
		await other.getByRole('button', { name: '举报' }).click()
		await other.getByRole('button', { name: '举报', exact: true }).click()
		await other.getByText('已举报').waitFor()
		// 举报以游客身份发，一个 cookie 都不带（core 按 IP 去重）
		const [report] = coreCalls(/\/report(?:\?|$)/)
		expect(report!.headers.cookie).toBeUndefined()
		expect(errors).toEqual([])
		await page.close()
	})

	it('读者能屏蔽别的登录读者（先确认）；站长看得到置顶与控制台，能设置状态', async () => {
		const { page, errors } = await open(`${POST_PATH}#comments`, 'reader')
		await page.locator('#comments').scrollIntoViewIfNeeded()
		const other = page.locator(`#comment-${OTHER_READER_ID}`)
		await other.getByRole('button', { name: '屏蔽此人' }).click()
		await other.getByText('你自己没法撤销').waitFor()
		core.requests.length = 0
		await other.getByRole('button', { name: '屏蔽', exact: true }).click()
		await expect.poll(() => coreCalls(/report-and-block/).length).toBe(1)
		expect(String(coreCalls(/report-and-block/)[0]!.headers.cookie)).toContain('better-auth.session_token=reader')
		// 自己的与游客的评论没有「屏蔽此人」
		expect(await page.locator(`#comment-${OWN_ID}`).getByRole('button', { name: '屏蔽此人' }).count()).toBe(0)
		await page.close()

		const owned = await open(`${POST_PATH}#comments`, 'owner')
		await owned.page.locator('#comments').scrollIntoViewIfNeeded()
		core.requests.length = 0
		await owned.page.locator(`#comment-${OTHER_READER_ID}`).getByRole('button', { name: '置顶' }).click()
		await expect.poll(() => coreCalls(new RegExp(`^/comments/${OTHER_READER_ID}(?:\\?|$)`)).filter(call => call.method === 'PATCH').length).toBe(1)
		expect(JSON.parse(coreCalls(new RegExp(`^/comments/${OTHER_READER_ID}(?:\\?|$)`)).find(call => call.method === 'PATCH')!.body)).toEqual({ pin: true })
		await owned.page.getByRole('link', { name: '控制台' }).waitFor()
		await owned.page.getByRole('button', { name: '设置状态' }).click()
		const dialog = owned.page.locator('dialog.owner-status-dialog[open]')
		await dialog.getByLabel('一句话').fill('在写主题')
		core.requests.length = 0
		await dialog.getByRole('button', { name: '保存' }).click()
		await expect.poll(() => coreCalls(/^\/fn\/shiro\/status/).filter(call => call.method === 'POST').length).toBe(1)
		expect(JSON.parse(coreCalls(/^\/fn\/shiro\/status/).find(call => call.method === 'POST')!.body)).toMatchObject({ desc: '在写主题', ttl: 3600 })
		expect([...errors, ...owned.errors]).toEqual([])
		await owned.page.close()
	})

	it('社交登录失败回来：说一声、去掉 ?error=、滚回评论区', async () => {
		const { page } = await open('/about')
		await page.evaluate(path => sessionStorage.setItem('mx-clarity:login', JSON.stringify({ from: 'comments', path, at: Date.now() })), POST_PATH)
		await page.goto(`${theme.url}${POST_PATH}?error=access_denied`, { waitUntil: 'networkidle' })
		await page.getByText('登录没有成功，请再试一次').waitFor()
		expect(new URL(page.url()).searchParams.has('error')).toBe(false)
		expect(await page.evaluate(() => sessionStorage.getItem('mx-clarity:login'))).toBeNull()
		// 参数内容不回显在页面文字里
		expect(await page.getByText('access_denied').count()).toBe(0)
		await page.close()
	})

	it('会员页：读者看得到我的评论与账号区块，注销要在页面里再确认一次', async () => {
		const { page, errors } = await open('/membership', 'reader')
		await page.getByRole('heading', { name: '我的评论' }).waitFor()
		await page.getByRole('link', { name: '语法示例' }).waitFor()
		await page.getByText('会员由站长开通，不会自动扣费。').waitFor()
		await page.getByRole('button', { name: '注销账号' }).click()
		await page.getByText('注销之后不能恢复。').waitFor()
		await page.getByRole('button', { name: '算了' }).click()
		await page.getByRole('button', { name: '注销账号' }).waitFor()
		expect(errors).toEqual([])
		await page.close()
	})
})
