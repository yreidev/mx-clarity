/**
 * 首页聚合与站点资料：最近动态（碎碎念与评论）、喜欢本站、随机说说、碎碎念引用、社交账号、标签总览。
 */
import { describe, expect, it } from 'vitest'
import { socialLinksOf } from '../../app/utils/mx/adapter'
import { commentExcerptOf } from '../../app/utils/mx/comment-body'
import { likeSite, loadAllSays, loadRecentComments, loadRecentThinking, loadSiteLikes, publicIndexOf, RECENT_COMMENTS, RECENT_THINKING, withPublicQuote } from '../../app/utils/mx/home'
import { themeConfigFrom } from '../../app/utils/mx/theme'
import { tagCountsOf } from '../../shared/utils/article'
import { clientWith, jsonResponse } from './helpers'

const pathOf = (request: Request) => new URL(request.url).pathname

const INDEX = publicIndexOf([
	{ path: '/posts/tech/hello', title: '公开的文章' },
	{ path: '/notes/2', title: '公开的日记' },
	{ path: '/about', title: '关于' },
])

describe('最近的碎碎念（/aggregate/top）', () => {
	it('只取碎碎念的正文开头，同一接口里的日记（带位置）、说说、引用都不带；最多留两条', async () => {
		const thinking = (id: number) => ({ id: `18400000000000000${id}`, content: `第 ${id} 条`, created_at: '2026-09-02T00:00:00.000Z' })
		const { client, requests } = clientWith(() => jsonResponse({ data: {
			notes: [{ id: '1', nid: 9, title: '带位置的日记', location: '某小区', coordinates: { latitude: 1, longitude: 2 } }],
			posts: [],
			says: [{ id: '10', text: '一条说说', created_at: '2026-09-01T00:00:00.000Z' }],
			recently: [{ id: '184000000000000001', content: '**加粗**的碎碎念 :tv_委屈:', created_at: '2026-09-02T00:00:00.000Z', ref: { title: '草稿标题' } }, thinking(2), thinking(3)],
		} }))
		const recent = await loadRecentThinking(client)
		expect(pathOf(requests[0]!)).toBe('/api/v3/aggregate/top')
		expect(recent).toHaveLength(RECENT_THINKING)
		expect(recent[0]).toEqual({ id: '184000000000000001', excerpt: '加粗的碎碎念 🥺', date: '2026-09-02T00:00:00.000Z', path: '/thinking/184000000000000001' })
		const out = JSON.stringify(recent)
		for (const leaked of ['某小区', 'latitude', '带位置的日记', '草稿标题', '一条说说'])
			expect(out).not.toContain(leaked)
	})
})

describe('最近动态（/activity/recent）', () => {
	const recent = {
		comment: [
			{ created_at: '2026-09-03T00:00:00.000Z', author: '读者', text: '写得好 [链接](javascript:alert(1)) <b>x</b>', avatar: 'https://cravatar.cn/avatar/1', type: 'post', id: 'p1', slug: 'hello', category: { slug: 'tech' }, title: 'core 给的标题' },
			{ created_at: '2026-09-03T00:00:00.000Z', author: 'a', text: '在谈加密日记', avatar: 'https://evil.example/pixel.gif', type: 'note', nid: 5, title: '加密日记的标题' },
			{ created_at: '2026-09-03T00:00:00.000Z', author: 'b', text: '碎碎念下的评论', type: 'recently', id: '184000000000000002' },
			{ created_at: '2026-09-03T00:00:00.000Z', author: 'c', text: '独立页', avatar: 'https://evil.example/pixel.gif', type: 'page', slug: 'about' },
		],
		like: [
			{ id: 'a1', created_at: '2026-09-04T00:00:00.000Z', type: 'post', slug: 'hello', title: 'x' },
			{ id: 'a2', created_at: '2026-09-04T00:00:00.000Z', type: 'note', nid: 2, title: 'x' },
			{ id: 'a3', created_at: '2026-09-04T00:00:00.000Z', type: 'note', nid: 5, title: '加密日记的标题' },
			{ id: 'a4', created_at: '2026-09-04T00:00:00.000Z', title: 'Deleted content' },
		],
		post: [{ title: '整篇文章' }],
		note: [{ title: '整篇日记', location: '某小区' }],
	}

	it('被评论的内容在公开集合里对得上才留，标题用缓存里的；对不上的整条丢掉；点赞不取', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: recent }))
		const comments = await loadRecentComments(client, INDEX)
		expect(pathOf(requests[0]!)).toBe('/api/v3/activity/recent')
		expect(comments.map(item => [item.author, item.title, item.path])).toEqual([
			['读者', '公开的文章', '/posts/tech/hello'],
			['b', '碎碎念', '/thinking/184000000000000002'],
			['c', '关于', '/about'],
		])
		const out = JSON.stringify(comments)
		for (const leaked of ['加密日记', 'core 给的标题', '整篇', '某小区', 'javascript:', 'Deleted content'])
			expect(out).not.toContain(leaked)
	})

	it('正文转纯文本，头像只认可信的头像服务', async () => {
		const { client } = clientWith(() => jsonResponse({ data: recent }))
		const comments = await loadRecentComments(client, INDEX)
		expect(comments[0]).toMatchObject({ excerpt: '写得好 链接 <b>x</b>', avatar: 'https://cravatar.cn/avatar/1' })
		expect(comments[2]!.avatar).toBeUndefined()
	})

	it('最多留三条', async () => {
		const comment = { created_at: '2026-09-03T00:00:00.000Z', author: '读者', text: '好', type: 'page', slug: 'about' }
		const { client } = clientWith(() => jsonResponse({ data: { comment: Array.from({ length: 5 }).fill(comment) } }))
		expect(await loadRecentComments(client, INDEX)).toHaveLength(RECENT_COMMENTS)
	})
})

describe('碎碎念引用的内容', () => {
	it('只在公开集合里对得上时保留，标题换成缓存里的；引用碎碎念照留', () => {
		expect(withPublicQuote({ quoted: { kind: 'note', path: '/notes/2', title: 'core 给的' } }, INDEX).quoted).toEqual({ kind: 'note', path: '/notes/2', title: '公开的日记' })
		expect(withPublicQuote({ quoted: { kind: 'note', path: '/notes/5', title: '加密日记的标题' } }, INDEX).quoted).toBeUndefined()
		expect(withPublicQuote({ quoted: { kind: 'thinking', path: '/thinking/1', title: '碎碎念' } }, INDEX).quoted).toMatchObject({ kind: 'thinking' })
	})

	it('编码与没编码的地址当成同一个', () => {
		const index = publicIndexOf([{ path: '/posts/%E6%8A%80%E6%9C%AF/a', title: '中文分类' }])
		expect(withPublicQuote({ quoted: { kind: 'post', path: '/posts/技术/a', title: 'x' } }, index).quoted?.title).toBe('中文分类')
	})
})

describe('喜欢本站与随机说说', () => {
	it('总数是一个数；取不到或不是数时按 0', async () => {
		expect(await loadSiteLikes(clientWith(() => jsonResponse({ data: 42 })).client)).toBe(42)
		expect(await loadSiteLikes(clientWith(() => jsonResponse({ data: 'x' })).client)).toBe(0)
	})

	it('点过的（core 回 400）当作已经喜欢过，别的错误照抛', async () => {
		const { client, requests } = clientWith(() => new Response(null, { status: 204 }))
		expect(await likeSite(client)).toBe('liked')
		expect(requests[0]!.method).toBe('POST')
		expect(pathOf(requests[0]!)).toBe('/api/v3/like_this')
		expect(await likeSite(clientWith(() => jsonResponse({ error: { code: 'BAD_REQUEST', message: 'Once a day is enough' } }, { status: 400 })).client)).toBe('already')
		await expect(likeSite(clientWith(() => new Response('x', { status: 500 })).client)).rejects.toBeTruthy()
	})

	it('全部说说：最多取两页，空的丢掉', async () => {
		const { client, requests } = clientWith((_, index) => jsonResponse({ data: {
			data: index === 0 ? [{ id: '1', text: '一', created_at: '2026-01-01T00:00:00.000Z' }, { id: '2', text: '  ', created_at: '2026-01-01T00:00:00.000Z' }] : [{ id: '3', text: '三', created_at: '2026-01-01T00:00:00.000Z' }],
			pagination: { total: 101, total_pages: 2, current_page: index + 1, size: 100 },
		} }))
		expect((await loadAllSays(client)).map(say => say.id)).toEqual(['1', '3'])
		expect(requests).toHaveLength(2)
	})
})

describe('站长的社交账号', () => {
	it('只认几个平台，按账号拼固定格式的地址', () => {
		expect(socialLinksOf({ github: 'someone', twitter: '@who', bilibili: 12345, mail: 'me@example.com' })).toEqual([
			{ icon: 'tabler:brand-github', text: 'GitHub', url: 'https://github.com/someone' },
			{ icon: 'tabler:brand-x', text: 'X', url: 'https://x.com/who' },
			{ icon: 'tabler:brand-bilibili', text: '哔哩哔哩', url: 'https://space.bilibili.com/12345' },
			{ icon: 'tabler:mail', text: '邮箱', url: 'mailto:me@example.com' },
		])
	})

	it('账号里有路径、协议、脚本的不收；认不出的平台跳过', () => {
		expect(socialLinksOf({ github: '../evil', zhihu: 'javascript:alert(1)', weibo: 'a/b', telegram: 'https://t.me/x', mail: 'no-at', myspace: 'x' })).toEqual([])
		expect(socialLinksOf(null)).toEqual([])
		expect(socialLinksOf(['github'])).toEqual([])
	})
})

describe('其余', () => {
	it('标签总览：篇数多的在前，同一篇里重复的标签只算一次', () => {
		expect(tagCountsOf([{ path: '/a', tags: ['b', 'a', 'a'] }, { path: '/b', tags: ['a'] }, { path: '/c' }])).toEqual([{ name: 'a', count: 2 }, { name: 'b', count: 1 }])
	})

	it('正文摘录：白名单过一遍再取文字，超长加省略号', () => {
		expect(commentExcerptOf('> 引用\n\n- 一\n- 二\n\n![图](https://x.example/a.png) `code`', 100)).toBe('引用 一 二 图片：图 code')
		expect(commentExcerptOf('字'.repeat(10), 5)).toBe('字字字字字…')
	})

	it('默认分享图只收站内路径或 https', () => {
		expect(themeConfigFrom({ ogImage: '/images/og.png' }).config.ogImage).toBe('/images/og.png')
		expect(themeConfigFrom({ ogImage: 'https://cdn.example.com/og.png' }).config.ogImage).toBe('https://cdn.example.com/og.png')
		for (const bad of ['http://x.example/og.png', 'javascript:alert(1)', 'https://x.example/a".png'])
			expect(themeConfigFrom({ ogImage: bad }).config.ogImage, bad).toBe('')
	})
})
