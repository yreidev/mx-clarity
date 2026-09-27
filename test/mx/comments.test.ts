import type { CommentBlock, CommentInline } from '../../app/types/comment'
import { describe, expect, it } from 'vitest'
import { renderCommentBody } from '../../app/utils/mx/comment-body'
import { commentErrorOf, loadAuthProviders, loadCommentHighlights, loadCommentPage, loadReaderSession, loadThreadBatch, parseCommentDraft, readerFromSession, submitComment, trustedAvatarOf } from '../../app/utils/mx/comments'
import { pickAuthCookies } from '../../app/utils/mx/cookie'
import { classifyMxError } from '../../app/utils/mx/errors'
import { clientWith, fixture, jsonResponse } from './helpers'

const pathOf = (request: Request) => new URL(request.url).pathname
const REF = '183590000000000001'

async function realPage() {
	const { client, requests } = clientWith(() => jsonResponse(fixture('comments-ref')))
	return { page: await loadCommentPage(client, REF, 1), requests }
}

/** 把正文里所有链接的地址收集起来 */
function hrefsOf(blocks: CommentBlock[]): string[] {
	const fromInline = (node: CommentInline): string[] => node.type === 'link'
		? [node.href, ...node.children.flatMap(fromInline)]
		: 'children' in node ? node.children.flatMap(fromInline) : []
	return blocks.flatMap((block): string[] => {
		switch (block.type) {
			case 'paragraph': return block.children.flatMap(fromInline)
			case 'quote': return hrefsOf(block.children)
			case 'list': return block.items.flatMap(hrefsOf)
			default: return []
		}
	})
}

describe('公开评论接口泄露的字段一概不往外传', () => {
	it('夹具里确实有 ip、UA 和读者邮箱（前提）', () => {
		const raw = JSON.stringify(fixture('comments-ref'))
		for (const leaked of ['"ip":"203.0.113.10"', 'curl/8.22.0', 'Version/17.0 Safari', 'dev@localhost.test'])
			expect(raw).toContain(leaked)
	})

	it('映射后一个都不剩，字段只有白名单里的', async () => {
		const { page } = await realPage()
		const out = JSON.stringify(page)
		for (const leaked of ['203.0.113.10', 'curl/8.22.0', 'Version/17.0 Safari', 'dev@localhost.test', '@example.test', '"ip"', '"agent"', '"mail"', '"reader"', '"location"'])
			expect(out).not.toContain(leaked)
		// agent 是解析好的「浏览器 · 系统」标签（默认不开，这里没有值），UA 原文不在其中
		const allowed = new Set(['id', 'author', 'avatar', 'url', 'body', 'date', 'pinned', 'identity', 'provider', 'parentId', 'agent', 'member', 'location', 'editedAt', 'authorTag', 'source', 'anchor'])
		for (const thread of page.items) {
			expect(Object.keys(thread).filter(k => !allowed.has(k))).toEqual(['replies', 'hidden'])
			for (const reply of thread.replies)
				expect(Object.keys(reply).filter(k => !allowed.has(k))).toEqual([])
		}
	})
})

describe('匿名评论零信任（夹具里的 XSS 评论）', () => {
	it('昵称按原样当文字，危险主页地址丢掉，正文里的 HTML 按字面显示', async () => {
		const { page } = await realPage()
		const xss = page.items.find(t => t.author === '<script>x</script>')!
		expect(xss.url).toBeUndefined()
		expect(xss.identity).toBe('guest')
		expect(hrefsOf(xss.body)).toEqual([])
		const text = JSON.stringify(xss.body)
		expect(text).toContain('<script>alert(2)</script>')
		expect(text).toContain('<img src=x onerror=alert(3)>')
		// javascript: 链接展开成文字
		expect(text).toContain('链接')
		expect(text).not.toContain('javascript:')
	})
})

describe('评论头像只认可信的头像服务', () => {
	it('cravatar、gravatar、社交登录的头像域名放行；别的地址、http、QQ 头像不放行', () => {
		for (const ok of [
			'https://cravatar.cn/avatar/aacc15ab45e2ac4925e52b6a667c93e6?d=retro',
			'https://cn.cravatar.com/avatar/x',
			'https://secure.gravatar.com/avatar/x',
			'https://weavatar.com/avatar/x',
			'https://avatars.githubusercontent.com/u/1?v=4',
			'https://lh3.googleusercontent.com/a/x',
		])
			expect(trustedAvatarOf(ok), ok).toBe(ok)
		for (const bad of [
			'https://tracker.example.test/pixel.png',
			'http://cravatar.cn/avatar/x',
			'https://q1.qlogo.cn/g?b=qq&nk=10000&s=100',
			'https://cravatar.cn.evil.test/avatar/x',
			'https://evilcravatar.cn/avatar/x',
			'javascript:alert(1)',
			undefined,
		])
			expect(trustedAvatarOf(bad), String(bad)).toBeUndefined()
	})

	it('站点自己与站长头像所在的域名另外放行', () => {
		expect(trustedAvatarOf('https://blog.example.test/api/v3/objects/avatar/me.png', ['blog.example.test'])).toBe('https://blog.example.test/api/v3/objects/avatar/me.png')
		expect(trustedAvatarOf('https://blog.example.test/api/v3/objects/avatar/me.png')).toBeUndefined()
	})

	it('映射评论时套用：不在白名单里的头像换成空，页面显示首字母', async () => {
		const raw = fixture('comments-ref')
		raw.data.data[0].avatar = 'https://tracker.example.test/pixel.png'
		const { client } = clientWith(() => jsonResponse(raw))
		const page = await loadCommentPage(client, '183590000000000001', 1)
		expect(page.items[0]!.avatar).toBeUndefined()
		expect(page.items[1]!.avatar).toMatch(/^https:\/\/cravatar\.cn\//)
	})
})

describe('评论下的「浏览器 · 系统」', () => {
	it('开着时只下发解析好的标签，UA 原文不下发；关着时一概没有', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('comments-ref')))
		const shown = await loadCommentPage(client, '183590000000000001', 1, { showAgent: true })
		const all = shown.items.flatMap(t => [t, ...t.replies])
		expect(all.find(c => c.author === '格式测试')?.agent).toBe('Chrome 140 · Windows')
		expect(all.find(c => c.author === 'Dev Owner')?.agent).toBe('Safari 17 · macOS')
		expect(all.find(c => c.author === '<script>x</script>')?.agent).toBeUndefined()
		expect(JSON.stringify(shown)).not.toContain('AppleWebKit')
		const hidden = await loadCommentPage(clientWith(() => jsonResponse(fixture('comments-ref'))).client, '183590000000000001', 1, { showAgent: false })
		expect(hidden.items.flatMap(t => [t, ...t.replies]).every(c => c.agent === undefined)).toBe(true)
	})
})

describe('楼层、楼中楼与折叠', () => {
	it('站长用读者身份发的评论认作站长；邮箱密码登录不算登录方式', async () => {
		const { page } = await realPage()
		const owner = page.items.find(t => t.author === 'Dev Owner')!
		expect(owner).toMatchObject({ identity: 'owner', provider: undefined })
		expect(owner.avatar).toMatch(/^https:\/\//)
	})

	it('回复楼主的不带 parentId，楼中楼带直接上级', async () => {
		const { page } = await realPage()
		const [first, second] = page.items.find(t => t.author === 'Dev Owner')!.replies
		expect(first).toMatchObject({ author: '访客甲', url: 'https://example.test/a', parentId: undefined, identity: 'guest' })
		expect(second).toMatchObject({ author: '访客乙', parentId: first!.id })
	})

	it('超过 20 条回复的楼层：头 3 尾 3，中段 17 条折叠，游标是头 3 条的最后一条', async () => {
		const { page } = await realPage()
		const many = page.items.find(t => t.author === '楼主')!
		expect(many.replies.map(r => r.author)).toEqual(['路人1', '路人2', '路人3', '路人21', '路人22', '路人23'])
		expect(many.hidden).toEqual({ count: 17, cursor: many.replies[2]!.id })
	})

	it('展开中段：带游标请求，没完时给下一个游标', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('comments-thread')))
		const batch = await loadThreadBatch(client, '184843629800460288', '184843630039535616')
		expect(pathOf(requests[0]!)).toBe('/api/v3/comments/thread/184843629800460288')
		expect(new URL(requests[0]!.url).searchParams.get('cursor')).toBe('184843630039535616')
		expect(batch.replies.map(r => r.author)).toEqual(['路人4', '路人5', '路人6', '路人7', '路人8', '路人9', '路人10', '路人11', '路人12', '路人13'])
		expect(batch.cursor).toBe(batch.replies.at(-1)!.id)
		const done = fixture('comments-thread')
		done.data.done = true
		const { client: last } = clientWith(() => jsonResponse(done))
		expect((await loadThreadBatch(last, '1', 'x')).cursor).toBeUndefined()
	})

	it('一页 10 层，分页照响应', async () => {
		const { page, requests } = await realPage()
		expect(new URL(requests[0]!.url).searchParams.get('size')).toBe('10')
		expect(page).toMatchObject({ page: 1, totalPages: 1, total: 4 })
	})
})

describe('评论正文的白名单子集', () => {
	it('夹具里的格式测试评论', async () => {
		const { page } = await realPage()
		const body = page.items.find(t => t.author === '格式测试')!.body
		expect(body.map(b => b.type)).toEqual(['paragraph', 'quote', 'list', 'code', 'paragraph'])
		expect(body[0]).toEqual({
			type: 'paragraph',
			children: [
				{ type: 'text', value: '第一段 ' },
				{ type: 'em', children: [{ type: 'text', value: '斜体' }] },
				{ type: 'text', value: ' ' },
				{ type: 'del', children: [{ type: 'text', value: '删除' }] },
				{ type: 'text', value: ' 与 ' },
				{ type: 'link', href: 'https://example.com/docs', children: [{ type: 'text', value: 'https://example.com/docs' }] },
				{ type: 'text', value: ' 自动链接' },
			],
		})
		expect(body[2]).toMatchObject({ type: 'list', ordered: false, items: [[{ type: 'paragraph' }], [{ type: 'paragraph' }]] })
		expect(body[3]).toEqual({ type: 'code', value: 'console.log(1)' })
		// 图片不加载，只留链接；行内 HTML 按字面；单个换行就是换行
		expect(body[4]).toEqual({
			type: 'paragraph',
			children: [
				{ type: 'link', href: 'https://example.test/x.png', children: [{ type: 'text', value: '图片：图' }] },
				{ type: 'text', value: ' <b>粗</b>' },
				{ type: 'break' },
				{ type: 'text', value: '换行后' },
			],
		})
	})

	it('单波浪线不是删除线；标题当段落；表格只留文字；分隔线丢掉', () => {
		expect(renderCommentBody('1~2 天')).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: '1~2 天' }] }])
		expect(renderCommentBody('# 大标题')).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: '大标题' }] }])
		expect(renderCommentBody('| a | b |\n| - | - |\n| 1 | 2 |\n\n---')).toEqual([
			{ type: 'paragraph', children: [{ type: 'text', value: 'a | b' }] },
			{ type: 'paragraph', children: [{ type: 'text', value: '1 | 2' }] },
		])
	})

	it('危险地址：链接展开成文字，图片只留替代文字', () => {
		for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test/x'])
			expect(hrefsOf(renderCommentBody(`[点我](${bad}) ![图](${bad})`))).toEqual([])
		expect(renderCommentBody('[点我](javascript:alert(1))')).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: '点我' }] }])
	})

	it('块级 HTML 按字面显示，不会变成元素', () => {
		expect(renderCommentBody('<script>\nalert(1)\n</script>')).toEqual([{
			type: 'paragraph',
			children: [{ type: 'text', value: '<script>' }, { type: 'break' }, { type: 'text', value: 'alert(1)' }, { type: 'break' }, { type: 'text', value: '</script>' }],
		}])
	})

	it('嵌套过深的引用只留文字，不会无限递归', () => {
		const body = renderCommentBody(`${'>'.repeat(50)} 深处`)
		let depth = 0
		let node: CommentBlock | undefined = body[0]
		while (node?.type === 'quote') {
			depth++
			node = node.children[0]
		}
		expect(depth).toBe(6)
		expect(node).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '深处' }] })
	})
})

describe('发评论前的校验（parseCommentDraft）', () => {
	const guest = { author: '访客', mail: 'a@example.test' }

	it('合格的匿名评论：去掉首尾空白，空网址不带', () => {
		expect(parseCommentDraft({ text: '  你好  ', as: 'guest', guest: { ...guest, url: '' } }))
			.toEqual({ text: '你好', as: 'guest', parentId: undefined, whisper: undefined, guest: { ...guest, url: undefined } })
	})

	it('读者身份不收昵称邮箱', () => {
		expect(parseCommentDraft({ text: '你好', as: 'reader', guest, whisper: true, parentId: '123' }))
			.toEqual({ text: '你好', as: 'reader', parentId: '123', whisper: true })
	})

	it('不合格的一律给提示', () => {
		const cases: unknown[] = [
			undefined,
			{ text: '   ', as: 'guest', guest },
			{ text: '字'.repeat(501), as: 'guest', guest },
			{ text: '你好', as: 'owner', guest },
			{ text: '你好', as: 'reader', parentId: '../x' },
			{ text: '你好', as: 'guest', guest: { ...guest, author: '' } },
			{ text: '你好', as: 'guest', guest: { ...guest, author: '名'.repeat(21) } },
			{ text: '你好', as: 'guest', guest: { ...guest, mail: 'not-mail' } },
			{ text: '你好', as: 'guest', guest: { ...guest, url: 'javascript:alert(1)' } },
			{ text: '你好', as: 'guest', guest: { ...guest, url: `https://${'a'.repeat(50)}.test` } },
		]
		for (const body of cases)
			expect(typeof parseCommentDraft(body), JSON.stringify(body)).toBe('string')
	})

	it('悄悄话只认 true', () => {
		expect(parseCommentDraft({ text: '你好', as: 'reader', whisper: 'yes' })).toMatchObject({ whisper: undefined })
	})
})

describe('发评论与发完之后的回查', () => {
	const created = (over: Record<string, unknown> = {}) => ({ data: { ...fixture('comments-ref').data.data[1], replies: undefined, reply_window: undefined, ...over } })

	it('匿名顶层评论：发给 guest 端点，再按最新一条回查，看得到就是 visible', async () => {
		const id = fixture('comments-ref').data.data[1].id
		const { client, requests } = clientWith(req => req.method === 'POST'
			? jsonResponse(created())
			: jsonResponse({ data: { data: [{ id }], meta: { pagination: { page: 1, size: 1, total: 1, total_pages: 1 } } } }))
		const result = await submitComment(client, REF, { text: '你好', as: 'guest', guest: { author: '访客', mail: 'a@example.test' } })
		expect(result.status).toBe('visible')
		expect(pathOf(requests[0]!)).toBe(`/api/v3/comments/guest/${REF}`)
		expect(await requests[0]!.json()).toEqual({ author: '访客', mail: 'a@example.test', text: '你好' })
		const check = new URL(requests[1]!.url)
		expect(check.pathname).toBe(`/api/v3/comments/ref/${REF}`)
		expect(Object.fromEntries(check.searchParams)).toMatchObject({ sort: 'newest', size: '1', page: '1' })
		// 带 ts 跳过 core 的 15 秒缓存
		expect(Number(check.searchParams.get('ts'))).toBeGreaterThan(0)
		expect(JSON.stringify(result.comment)).not.toContain('@example.test')
	})

	it('回查看不到就是 pending（开了审核）', async () => {
		const { client } = clientWith(req => req.method === 'POST'
			? jsonResponse(created())
			: jsonResponse({ data: { data: [{ id: 'other' }], meta: { pagination: { page: 1, size: 1, total: 1, total_pages: 1 } } } }))
		expect((await submitComment(client, REF, { text: '你好', as: 'guest', guest: { author: '访客', mail: 'a@example.test' } })).status).toBe('pending')
	})

	it('悄悄话不必回查', async () => {
		const { client, requests } = clientWith(() => jsonResponse(created({ is_whispers: true })))
		expect((await submitComment(client, REF, { text: '悄悄', as: 'guest', whisper: true, guest: { author: '访客', mail: 'a@example.test' } })).status).toBe('whisper')
		expect(requests).toHaveLength(1)
		expect(await requests[0]!.json()).toMatchObject({ isWhispers: true })
	})

	it('读者回复：只发正文，回查所在楼层', async () => {
		const reply = created({ root_comment_id: '900', parent_comment_id: '901', reader_id: '5' })
		const { client, requests } = clientWith(req => req.method === 'POST'
			? jsonResponse(reply)
			: jsonResponse({ data: { replies: [{ id: reply.data.id }], remaining: 0, done: true, next_cursor: null } }))
		const result = await submitComment(client, REF, { text: '回复', as: 'reader', parentId: '901' })
		expect(pathOf(requests[0]!)).toBe('/api/v3/comments/reader/reply/901')
		expect(await requests[0]!.json()).toEqual({ text: '回复' })
		expect(pathOf(requests[1]!)).toBe('/api/v3/comments/thread/900')
		expect(Number(new URL(requests[1]!.url).searchParams.get('ts'))).toBeGreaterThan(0)
		expect(result).toMatchObject({ status: 'visible', comment: { parentId: '901', identity: 'reader' } })
	})

	it('楼层超过 20 条查不全时按看得到处理；回查失败也按看得到处理', async () => {
		const reply = created({ root_comment_id: '900', parent_comment_id: '900' })
		const { client } = clientWith(req => req.method === 'POST'
			? jsonResponse(reply)
			: jsonResponse({ data: { replies: [], remaining: 7, done: false, next_cursor: '1' } }))
		expect((await submitComment(client, REF, { text: '回复', as: 'guest', parentId: '900', guest: { author: '访客', mail: 'a@example.test' } })).status).toBe('visible')
		const { client: flaky } = clientWith(req => req.method === 'POST' ? jsonResponse(created()) : new Response('boom', { status: 502 }))
		expect((await submitComment(flaky, REF, { text: '你好', as: 'guest', guest: { author: '访客', mail: 'a@example.test' } })).status).toBe('visible')
	})
})

describe('发评论失败的提示（实测的错误响应）', () => {
	async function failureOf(body: unknown, status: number) {
		const { client } = clientWith(() => jsonResponse(body, { status }))
		return client.comment.guestComment(REF, { author: 'x', mail: 'a@example.test', text: 'x' }).catch(classifyMxError)
	}

	it.each([
		[{ error: { code: 'INVALID_PARAMETER', message: 'That name belongs to the site owner' } }, 400, 400, '这个昵称不能用，换一个吧'],
		[{ error: { code: 'AUTH_NOT_LOGGED_IN', message: 'Not logged in' } }, 401, 401, '登录已失效，请重新登录'],
		[{ error: { code: 'HTTP_ERROR', message: 'Whoops, you already said this' } }, 409, 409, '同样的内容刚刚已经发过了'],
		[{ error: { code: 'COMMENT_DISABLED', message: 'x' } }, 403, 403, '评论已关闭'],
		[{ error: { code: 'COMMENT_FORBIDDEN', message: 'x' } }, 403, 403, '这里不接受匿名评论，请登录后再发'],
		[{ error: { code: 'VALIDATION_FAILED', message: 'x' } }, 400, 400, expect.stringContaining('内容不合要求')],
		[{ error: { code: 'INTERNAL', message: 'x' } }, 500, 503, '评论服务暂时不可用，请稍后再试'],
	])('%j → %i', async (body, status, statusCode, message) => {
		const failure = await failureOf(body, status)
		expect(commentErrorOf(failure as ReturnType<typeof classifyMxError>)).toEqual({ statusCode, message })
	})
})

describe('读者会话与 cookie', () => {
	it('只转 Better Auth 的 cookie', () => {
		expect(pickAuthCookies('nuxt-color-mode=dark; __Secure-better-auth.session_token=abc.def%3D; _ga=1; better-auth.session_data=xyz'))
			.toBe('__Secure-better-auth.session_token=abc.def%3D; better-auth.session_data=xyz')
		expect(pickAuthCookies(['a=1', 'better-auth.session_token=t'])).toBe('better-auth.session_token=t')
		expect(pickAuthCookies('better-authx.session_token=t; xbetter-auth.a=1; better-auth.=1')).toBeUndefined()
		expect(pickAuthCookies(undefined)).toBeUndefined()
		expect(pickAuthCookies('')).toBeUndefined()
	})

	it('会话只取昵称、头像、登录方式和是否站长', () => {
		// GET /auth/session 返回的字段（camelCase 之后）
		const session = { id: '183582625582026752', name: 'Dev Owner', email: 'dev@localhost.test', emailVerified: true, image: 'https://cravatar.cn/avatar/x', role: 'owner', handle: 'devowner', username: 'devowner', displayUsername: 'Dev Owner', provider: 'credential', providerAccountId: '1' }
		expect(readerFromSession(session)).toEqual({ name: 'Dev Owner', avatar: 'https://cravatar.cn/avatar/x', provider: undefined, isOwner: true })
		expect(readerFromSession({ name: '读者', image: 'http://x.test/a.png', provider: 'github', role: 'reader' }))
			.toEqual({ name: '读者', avatar: undefined, provider: 'github', isOwner: false })
		expect(readerFromSession(null)).toBeNull()
		expect(readerFromSession({ email: 'x@example.test' })).toBeNull()
	})

	it('没登录时 core 返回 { data: null }（实测），当作没有读者', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: null }))
		expect(await loadReaderSession(client)).toBeNull()
		expect(pathOf(requests[0]!)).toBe('/api/v3/auth/session')
	})

	it('登录时取 data 里的会话', async () => {
		const { client } = clientWith(() => jsonResponse({ data: { name: '读者', image: 'https://a.test/x.png', provider: 'github', role: 'reader', email: 'r@example.test' } }))
		expect(await loadReaderSession(client)).toEqual({ name: '读者', avatar: 'https://a.test/x.png', provider: 'github', isOwner: false })
	})

	it('登录方式：没配社交登录时是空数组；不像名字的丢掉', async () => {
		const { client } = clientWith(() => jsonResponse({ data: [] }))
		expect(await loadAuthProviders(client)).toEqual([])
		const { client: configured, requests } = clientWith(() => jsonResponse({ data: ['github', 'google', '<x>', 'credential', 3] }))
		expect(await loadAuthProviders(configured)).toEqual(['github', 'google'])
		expect(pathOf(requests[0]!)).toBe('/api/v3/auth/providers')
	})
})

describe('正文高亮用的带锚点评论', () => {
	it('头像与评论区一样只认可信名单（加上站点自己的域名），不可信的不给', async () => {
		const anchor = (quote: string) => ({ mode: 'range', block_id: 'b1', quote, prefix: '', suffix: '', start_offset: 0, end_offset: quote.length })
		const { client } = clientWith(() => jsonResponse({ data: { data: [
			{ id: '1', author: '甲', avatar: 'https://cravatar.cn/avatar/1', text: '好', anchor: anchor('第一句') },
			{ id: '2', author: '乙', avatar: 'https://blog.example.com/avatar.png', text: '嗯', anchor: anchor('第一句') },
			{ id: '3', author: '丙', avatar: 'https://evil.example/pixel.gif', text: '哦', anchor: anchor('第一句') },
		], meta: { pagination: { page: 1, size: 50, total: 3, total_pages: 1 } } } }))
		const blocks = { b1: { type: 'paragraph', text: '第一句，第二句' } }
		const items = await loadCommentHighlights(client, 'r1', blocks, ['blog.example.com'])
		expect(items.map(item => [item.author, item.avatar])).toEqual([['甲', 'https://cravatar.cn/avatar/1'], ['乙', 'https://blog.example.com/avatar.png'], ['丙', undefined]])
	})
})
