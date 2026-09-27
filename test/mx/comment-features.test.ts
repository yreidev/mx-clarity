/**
 * 评论的功能：表情名、站内图片、归属地、排序、按 id 定位、编辑、举报、我的评论。
 */
import type { CommentBlock } from '../../app/types/comment'
import { describe, expect, it } from 'vitest'
import { commentImagePrefixesOf, renderCommentBody, trustedImageOf } from '../../app/utils/mx/comment-body'
import { commentFromModel, commentSortOf, editComment, loadCommentPage, loadMyComments, locateComment, locationLabelOf, myCommentPathOf, readerFromSession, reportComment } from '../../app/utils/mx/comments'
import { replaceOwo } from '../../app/utils/mx/owo'
import { themeConfigFrom } from '../../app/utils/mx/theme'
import { isEditableAt } from '../../shared/utils/comment'
import { blocksAccountDeletion, subscriptionManageTextOf } from '../../shared/utils/membership'
import { clientWith, fixture, jsonResponse } from './helpers'

const REF = '183590000000000001'
const pathOf = (request: Request) => new URL(request.url).pathname
const paramsOf = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)
const notFound = () => jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })
const tag = (id: string) => `tag-${id}`

/** 线格式的一条评论 */
function wire(over: Record<string, unknown> = {}) {
	return { ...fixture('comments-ref').data.data[1], replies: undefined, reply_window: undefined, ...over }
}

function textOf(blocks: CommentBlock[]) {
	return JSON.stringify(blocks)
}

describe('迁移来的 OwO 表情名', () => {
	it('表里有的换成 Unicode 表情，前缀不参与', () => {
		expect(replaceOwo(':tv_委屈::tv_doge: 好:微笑:')).toBe('🥺🐶 好🙂')
	})

	it('带包名、表里没有的汉字名显示成方括号；不带包名的不动', () => {
		expect(replaceOwo(':tv_不存在:')).toBe('[不存在]')
		expect(replaceOwo('时间:下午三点:地点')).toBe('时间:下午三点:地点')
	})

	it('时间、代码里的冒号不误伤，结尾的冒号还能给下一个用', () => {
		expect(replaceOwo('12:30:45 :root: a:b:')).toBe('12:30:45 :root: a:b:')
		expect(replaceOwo('10:30:tv_委屈:')).toBe('10:30🥺')
	})

	it('只换正文文字：行内代码、代码块里的原样', () => {
		const body = renderCommentBody('哈:tv_委屈: `:tv_委屈:`\n\n```\n:tv_委屈:\n```')
		expect(body[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', value: '哈🥺 ' }, { type: 'code', value: ':tv_委屈:' }] })
		expect(body[1]).toEqual({ type: 'code', value: ':tv_委屈:' })
	})
})

describe('评论里的图片：只显示站点自己存储的', () => {
	const prefixes = commentImagePrefixesOf({ webUrl: 'https://blog.example.com', serverUrl: 'https://api.example.com/v2' }, ['https://cdn.example.com/'])

	it('前缀来自 core 地址、站点的 /api/v3 与主题配置', () => {
		expect(prefixes.toSorted()).toEqual([
			'https://api.example.com/v2/objects/image/',
			'https://blog.example.com/api/v3/objects/image/',
			'https://cdn.example.com/',
		])
		// http 的地址不收
		expect(commentImagePrefixesOf({ webUrl: 'http://blog.example.com', serverUrl: '' })).toEqual([])
	})

	it('地址对得上才是图片，别处的照旧是链接', () => {
		const body = renderCommentBody('![猫](https://blog.example.com/api/v3/objects/image/comments/1/a.webp) ![狗](https://evil.example/a.png)', { imagePrefixes: prefixes })
		expect(body).toEqual([{ type: 'paragraph', children: [
			{ type: 'image', src: 'https://blog.example.com/api/v3/objects/image/comments/1/a.webp', alt: '猫' },
			{ type: 'text', value: ' ' },
			{ type: 'link', href: 'https://evil.example/a.png', children: [{ type: 'text', value: '图片：狗' }] },
		] }])
	})

	it('绕路的写法一概不认：点段、用户名、相似域名、http', () => {
		for (const bad of [
			'https://blog.example.com/api/v3/objects/image/../../../evil.png',
			'https://blog.example.com@evil.example/api/v3/objects/image/a.png',
			'https://user@cdn.example.com/a.png',
			'https://cdn.example.com.evil.example/a.png',
			'https://blog.example.com/api/v3/objects/imagex/a.png',
			'http://cdn.example.com/a.png',
			'javascript:alert(1)',
		])
			expect(trustedImageOf(bad, prefixes), bad).toBeUndefined()
		expect(trustedImageOf('https://cdn.example.com/a/b.png', prefixes)).toBe('https://cdn.example.com/a/b.png')
	})

	it('没配前缀时一张都不显示', () => {
		expect(textOf(renderCommentBody('![x](https://blog.example.com/api/v3/objects/image/a.png)'))).not.toContain('"image"')
	})

	it('主题配置的 imageHosts 只收 https，规范成以 / 结尾', () => {
		const { config, warnings } = themeConfigFrom({ comments: { imageHosts: ['https://cdn.example.com', 'https://cdn.example.com/img/', 'http://x.example', 'https://u:p@x.example', 'https://x.example/?a=1'] } })
		expect(config.comments.imageHosts).toEqual(['https://cdn.example.com/', 'https://cdn.example.com/img/'])
		expect(warnings.join()).toContain('comments.imageHosts')
	})
})

describe('归属地只用来显示', () => {
	it('中文原样（去控制字符、限长），英文拼串有国家码时换成中文国名', () => {
		expect(locationLabelOf('广东省深圳市\u202E')).toBe('广东省深圳市')
		expect(locationLabelOf('ChinaGuangdongShenzhen', 'CN')).toBe('中国')
		expect(locationLabelOf('United StatesCaliforniaLos Angeles', 'US')).toBe('美国')
		expect(locationLabelOf('Somewhere', 'zz')).toBe('Somewhere')
		expect(locationLabelOf('中'.repeat(30))).toHaveLength(20)
	})

	it('没有 location 就不显示（站长关了公开归属地，国家码再有也不用）', () => {
		expect(locationLabelOf(null, 'CN')).toBeUndefined()
		expect(locationLabelOf('  ', 'CN')).toBeUndefined()
	})

	it('映射进评论', () => {
		expect(commentFromModel({ id: '1', text: 'x', createdAt: '2026-01-01T00:00:00.000Z', location: '浙江杭州', countryCode: 'CN' } as never).location).toBe('浙江杭州')
	})
})

describe('排序', () => {
	it('只认三种，其余按默认', () => {
		expect(['pinned', 'newest', 'oldest', 'hot', undefined, ['newest']].map(commentSortOf)).toEqual(['pinned', 'newest', 'oldest', 'pinned', 'pinned', 'pinned'])
	})

	it('默认不带 sort，别的原样透传给 core', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('comments-ref')))
		await loadCommentPage(client, REF, 1)
		await loadCommentPage(client, REF, 2, { sort: 'oldest' })
		expect(paramsOf(requests[0]!).sort).toBeUndefined()
		expect(paramsOf(requests[1]!)).toMatchObject({ sort: 'oldest', page: '2' })
	})
})

describe('自己的评论：不透明标识与编辑预填', () => {
	const NOW = Date.parse('2026-09-25T00:10:00.000Z')

	it('读者评论带标识，可编辑时间内另带原文；游客与站长的都不带', () => {
		const reader = commentFromModel({ id: '1', text: '原文', readerId: 'r1', createdAt: '2026-09-25T00:05:00.000Z' } as never, { tagOf: tag, now: NOW })
		expect(reader).toMatchObject({ authorTag: 'tag-r1', source: '原文' })
		const old = commentFromModel({ id: '1', text: '原文', readerId: 'r1', createdAt: '2026-09-24T00:00:00.000Z' } as never, { tagOf: tag, now: NOW })
		expect(old.authorTag).toBe('tag-r1')
		expect(old.source).toBeUndefined()
		const guest = commentFromModel({ id: '1', text: '原文', readerId: null, createdAt: '2026-09-25T00:05:00.000Z' } as never, { tagOf: tag, now: NOW })
		expect(guest.authorTag).toBeUndefined()
		const owner = commentFromModel({ id: '1', text: '原文', readerId: 'o', isOwnerReply: true, createdAt: '2026-09-25T00:05:00.000Z' } as never, { tagOf: tag, now: NOW })
		expect(owner.authorTag).toBeUndefined()
	})

	it('会话下发同一种标识，不下发读者 id；站长不带', () => {
		expect(readerFromSession({ id: 'r1', name: '读者', role: 'reader' }, tag)).toMatchObject({ tag: 'tag-r1' })
		expect(JSON.stringify(readerFromSession({ id: 'r1', name: '读者', role: 'reader' }, tag))).not.toContain('"r1"')
		expect(readerFromSession({ id: 'o1', name: '站长', role: 'owner' }, tag)?.tag).toBeUndefined()
	})

	it('改过的带 editedAt', () => {
		expect(commentFromModel({ id: '1', text: 'x', createdAt: '2026-01-01T00:00:00.000Z', editedAt: '2026-01-02T00:00:00.000Z' } as never).editedAt).toBe('2026-01-02T00:00:00.000Z')
	})

	it('可编辑时间是 10 分钟', () => {
		expect(isEditableAt('2026-09-25T00:00:01.000Z', NOW)).toBe(true)
		expect(isEditableAt('2026-09-24T23:59:59.000Z', NOW)).toBe(false)
		expect(isEditableAt('坏日期', NOW)).toBe(false)
	})
})

describe('按 id 定位评论', () => {
	it('顶层评论：用 around 让 core 定位，页里有它才算找到', async () => {
		const top = wire({ id: '500', ref_id: REF, root_comment_id: null, replies: [] })
		const { client, requests } = clientWith(req => pathOf(req) === '/api/v3/comments/500'
			? jsonResponse({ data: top })
			: jsonResponse({ data: { data: [top], meta: { pagination: { page: 3, total_pages: 5 } } } }))
		const found = await locateComment(client, REF, '500')
		expect(found).toMatchObject({ targetId: '500', thread: { id: '500' } })
		expect(paramsOf(requests[0]!).ts).toBeTruthy()
		expect(pathOf(requests[1]!)).toBe(`/api/v3/comments/ref/${REF}`)
		expect(paramsOf(requests[1]!)).toMatchObject({ around: '500' })
		// GET /comments/:id 带的 ip、UA 不往外传
		expect(JSON.stringify(found)).not.toContain('203.0.113')
	})

	it('公开列表里没有它（待审核、垃圾），就是找不到', async () => {
		const top = wire({ id: '500', ref_id: REF, root_comment_id: null, state: 0 })
		const { client } = clientWith(req => pathOf(req) === '/api/v3/comments/500'
			? jsonResponse({ data: top })
			: jsonResponse({ data: { data: [wire({ id: '1' })], meta: { pagination: { page: 1, total_pages: 1 } } } }))
		expect(await locateComment(client, REF, '500')).toBeUndefined()
	})

	it('不属于这篇、悄悄话、404 都当成找不到，不再往下查', async () => {
		for (const raw of [wire({ id: '500', ref_id: '999' }), wire({ id: '500', ref_id: REF, is_whispers: true })]) {
			const { client, requests } = clientWith(() => jsonResponse({ data: raw }))
			expect(await locateComment(client, REF, '500')).toBeUndefined()
			expect(requests).toHaveLength(1)
		}
		const { client } = clientWith(notFound)
		expect(await locateComment(client, REF, '500')).toBeUndefined()
	})

	it('回复在折叠的中段里：沿游标往后翻到为止', async () => {
		const root = wire({
			id: '600',
			ref_id: REF,
			root_comment_id: null,
			replies: [wire({ id: '601', root_comment_id: '600', parent_comment_id: '600' })],
			reply_window: { has_hidden: true, hidden_count: 12, next_cursor: '601' },
		})
		const { client } = clientWith((req) => {
			const path = pathOf(req)
			if (path === '/api/v3/comments/655')
				return jsonResponse({ data: wire({ id: '655', ref_id: REF, root_comment_id: '600', parent_comment_id: '600' }) })
			if (path === `/api/v3/comments/ref/${REF}`)
				return jsonResponse({ data: { data: [root], meta: { pagination: { page: 1, total_pages: 1 } } } })
			const cursor = new URL(req.url).searchParams.get('cursor')
			return cursor === '601'
				? jsonResponse({ data: { replies: [wire({ id: '610', root_comment_id: '600' })], remaining: 11, done: false, next_cursor: '610' } })
				: jsonResponse({ data: { replies: [wire({ id: '655', root_comment_id: '600' })], remaining: 0, done: true, next_cursor: null } })
		})
		const found = await locateComment(client, REF, '655')
		expect(found?.targetId).toBe('655')
		expect(found?.thread.replies.map(reply => reply.id)).toEqual(['601', '610', '655'])
	})
})

describe('编辑自己的评论', () => {
	const NOW = Date.parse('2026-09-25T00:10:00.000Z')
	const session = (body: unknown) => clientWith(req => pathOf(req) === '/api/v3/auth/session' ? jsonResponse({ data: body }) : new Response(null, { status: 204 }))
	const comment = (over: Record<string, unknown> = {}) => clientWith(() => jsonResponse({ data: wire({ id: '700', reader_id: 'r1', created_at: '2026-09-25T00:05:00.000Z', ...over }) }))

	it('本人、10 分钟内：转 PATCH /comments/edit/:id，正文由这里重新渲染', async () => {
		const me = session({ id: 'r1', name: '读者', role: 'reader' })
		const result = await editComment(me.client, comment().client, '700', '改好了 **加粗**', { now: NOW })
		const patch = me.requests.find(req => req.method === 'PATCH')!
		expect(pathOf(patch)).toBe('/api/v3/comments/edit/700')
		expect(await patch.json()).toEqual({ text: '改好了 **加粗**' })
		expect(result.body).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: '改好了 ' }, { type: 'strong', children: [{ type: 'text', value: '加粗' }] }] }])
		expect(result.editedAt).toBe(new Date(NOW).toISOString())
	})

	it('站长的会话一律拒绝（core 那里站长能改任何人的）', async () => {
		const me = session({ id: 'o1', name: '站长', role: 'owner' })
		await expect(editComment(me.client, comment().client, '700', 'x', { now: NOW })).rejects.toMatchObject({ statusCode: 403, message: '站长请在后台编辑评论' })
		expect(me.requests.some(req => req.method === 'PATCH')).toBe(false)
	})

	it('别人的、超过 10 分钟的、没登录的都不转', async () => {
		const me = session({ id: 'r1', name: '读者', role: 'reader' })
		await expect(editComment(me.client, comment({ reader_id: 'r2' }).client, '700', 'x', { now: NOW })).rejects.toMatchObject({ statusCode: 403 })
		await expect(editComment(me.client, comment({ created_at: '2026-09-24T00:00:00.000Z' }).client, '700', 'x', { now: NOW })).rejects.toMatchObject({ statusCode: 403 })
		await expect(editComment(session(null).client, comment().client, '700', 'x', { now: NOW })).rejects.toMatchObject({ statusCode: 401 })
		expect(me.requests.some(req => req.method === 'PATCH')).toBe(false)
	})
})

describe('举报', () => {
	it('转 POST /comments/:id/report，不带任何内容', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { ok: true } }))
		await reportComment(client, '800')
		expect(requests[0]!.method).toBe('POST')
		expect(pathOf(requests[0]!)).toBe('/api/v3/comments/800/report')
		expect(requests[0]!.headers.get('cookie')).toBeNull()
	})
})

describe('我的评论', () => {
	it('来源拼成站内地址，slug 编码、点段不收', () => {
		expect(myCommentPathOf({ refType: 'posts', source: { categorySlug: 'tech', slug: '你好' } })).toBe('/posts/tech/%E4%BD%A0%E5%A5%BD')
		expect(myCommentPathOf({ refType: 'posts', source: { categorySlug: 'tech', slug: 'a/b' } })).toBeUndefined()
		expect(myCommentPathOf({ refType: 'notes', source: { nid: 12 } })).toBe('/notes/12')
		expect(myCommentPathOf({ refType: 'pages', source: { slug: 'about' } })).toBe('/about')
		expect(myCommentPathOf({ refType: 'recentlies', refId: '184000000000000001', source: {} })).toBe('/thinking/184000000000000001')
		expect(myCommentPathOf({ refType: 'posts', source: { categorySlug: '..', slug: 'x' } })).toBeUndefined()
		expect(myCommentPathOf({ refType: 'notes', source: { nid: '12' } })).toBeUndefined()
		expect(myCommentPathOf({ refType: 'posts', source: null })).toBeUndefined()
	})

	it('状态：404 是悄悄话，state 1 已公开，state 0 在公开列表里找得到才算公开', async () => {
		const rows = [
			{ id: '901', ref_id: REF, ref_type: 'posts', source: { category_slug: 'tech', slug: 'a' }, source_title: '文章\u0000标题', text: '一', created_at: '2026-09-25T00:00:00.000Z' },
			{ id: '902', ref_id: REF, ref_type: 'posts', source: { category_slug: 'tech', slug: 'a' }, source_title: '文章', text: '二', created_at: '2026-09-25T00:00:00.000Z' },
			{ id: '903', ref_id: REF, ref_type: 'posts', source: null, source_title: null, text: '三', created_at: '2026-09-25T00:00:00.000Z' },
			{ id: '904', ref_id: REF, ref_type: 'posts', source: { category_slug: 'tech', slug: 'a' }, source_title: '文章', text: '四', created_at: '2026-09-25T00:00:00.000Z' },
		]
		const session = clientWith(() => jsonResponse({ data: { data: rows, meta: { pagination: { page: 1, total: 4, total_pages: 1 } } } }))
		const anonymous = clientWith((req) => {
			const path = pathOf(req)
			if (path === '/api/v3/comments/901')
				return notFound()
			if (path === '/api/v3/comments/902')
				return jsonResponse({ data: wire({ id: '902', ref_id: REF, state: 1 }) })
			if (path === '/api/v3/comments/903')
				return jsonResponse({ data: wire({ id: '903', ref_id: REF, state: 0, root_comment_id: null }) })
			if (path === '/api/v3/comments/904')
				return jsonResponse({ data: wire({ id: '904', ref_id: REF, state: 0, root_comment_id: null }) })
			// 公开列表里只有 903
			return jsonResponse({ data: { data: [{ id: '903' }], meta: { pagination: { page: 1, total_pages: 1 } } } })
		})
		const page = await loadMyComments(session.client, anonymous.client, 1)
		expect(pathOf(session.requests[0]!)).toBe('/api/v3/comments/reader/me')
		expect(page.items.map(item => [item.id, item.status])).toEqual([['901', 'whisper'], ['902', 'visible'], ['903', 'visible'], ['904', 'pending']])
		expect(page.items[0]).toMatchObject({ path: '/posts/tech/a#comment-901', title: '文章标题' })
		expect(page.items[2]!.path).toBeUndefined()
		// 查状态不带读者的 cookie
		expect(anonymous.requests.every(req => req.headers.get('cookie') === null)).toBe(true)
	})
})

describe('停订途径与注销的拦截', () => {
	it('按开通方式写停订途径', () => {
		expect(subscriptionManageTextOf('dodo')).toBe('订阅由 Dodo Payments 代收，在 Dodo Payments 发给你的付款邮件里管理或取消；找不到的话请联系站长。')
		expect(subscriptionManageTextOf('manual')).toContain('不会自动扣费')
		expect(subscriptionManageTextOf('apple')).toContain('Apple')
		expect(subscriptionManageTextOf(undefined)).toContain('支付平台')
	})

	it('还在自动续费（active、on_hold，不是站长手动开的）就拦下', () => {
		expect(blocksAccountDeletion({ status: 'active', provider: 'dodo' })).toBe(true)
		expect(blocksAccountDeletion({ status: 'on_hold' })).toBe(true)
		expect(blocksAccountDeletion({ status: 'active', provider: 'manual' })).toBe(false)
		expect(blocksAccountDeletion({ status: 'expired', provider: 'dodo' })).toBe(false)
		expect(blocksAccountDeletion(null)).toBe(false)
	})
})
