import type { ArticleProps } from '../../app/types/article'
import type { TimelineEntry } from '../../app/types/timeline'
import { describe, expect, it } from 'vitest'
import { classifyMxError } from '../../app/utils/mx/errors'
import { loadProjects, loadSitemapEntries, loadTimeline, noteNeighborsOf, statsFrom, topReadFrom, updatesSince } from '../../app/utils/mx/explore'
import { applyLink, linkErrorOf, parseLinkApplication } from '../../app/utils/mx/links'
import { canApplyLink, loadLinkGroups, loadPageDetail } from '../../app/utils/mx/pages'
import { loadSearch, SEARCH_PAGE_SIZE } from '../../app/utils/mx/search'
import { countedWordsOf } from '../../shared/utils/article'
import { clientWith, fixture, jsonResponse } from './helpers'

const pathOf = (request: Request) => new URL(request.url).pathname

describe('搜索', () => {
	it('一次搜三种内容，地址按路由规则拼；分页字段是 current_page / total_page', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('search-all')))
		const page = await loadSearch(client, '示例', 1)
		expect(page).toMatchObject({ page: 1, totalPages: 1, total: 3 })
		expect(page.items.map(hit => [hit.type, hit.path])).toEqual([
			['note', '/notes/2'],
			['post', '/posts/essay/sample-step-by-step'],
			['page', '/lexical-page'],
		])
		const url = new URL(requests[0]!.url)
		expect(url.pathname).toBe('/api/v3/search')
		expect(Object.fromEntries(url.searchParams)).toMatchObject({ keyword: '示例', page: '1', size: String(SEARCH_PAGE_SIZE) })
	})

	it('不带整篇正文，只留片段与命中词；文章带分类名', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('search-all')))
		const { items } = await loadSearch(client, '示例', 1)
		expect(JSON.stringify(fixture('search-all'))).toContain('"text"')
		for (const hit of items)
			expect(Object.keys(hit).sort()).toEqual(['category', 'date', 'id', 'keywords', 'path', 'snippet', 'title', 'type'])
		const post = items.find(hit => hit.type === 'post')!
		expect(post.category).toBe('随笔')
		expect(post.keywords).toEqual(['示例'])
		expect(post.snippet).toContain('示例')
		expect(items.find(hit => hit.type === 'note')!.category).toBeUndefined()
	})

	it('缺字段、类型不认识的结果丢掉；只命中标题时没有片段', async () => {
		const data = fixture('search-all')
		data.data.data.push({ type: 'recently', id: 'x', title: 'x' }, { type: 'post', id: 'y', title: 'y', slug: 'y' })
		data.data.data[0].highlight = { keywords: ['示例', 3], snippet: null }
		const { client } = clientWith(() => jsonResponse(data))
		const { items } = await loadSearch(client, '示例', 1)
		expect(items).toHaveLength(3)
		expect(items[0]).toMatchObject({ snippet: undefined, keywords: ['示例'] })
	})
})

describe('搜索不漏付费文章的正文', () => {
	it('前提：core 对锁定的付费文章截断了正文，片段却是从全文里截的', () => {
		const raw = fixture('search-premium-body').data.data[0]
		expect(raw.is_premium).toBe(true)
		expect(raw.text).not.toContain('hiddenword')
		expect(raw.highlight.snippet).toContain('hiddenword')
	})

	it('只在正文里命中的付费文章整条不列', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('search-premium-body')))
		expect((await loadSearch(client, 'hiddenword', 1)).items).toEqual([])
	})

	it('标题命中的照列，片段换成公开的摘要', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('search-premium-title')))
		const [hit] = (await loadSearch(client, '长文', 1)).items
		expect(hit).toMatchObject({ path: '/posts/essay/sample-step-by-step', snippet: fixture('search-premium-title').data.data[0].summary })
	})

	it('摘要里有这个词的照列，片段也换成摘要', async () => {
		const data = fixture('search-premium-body')
		data.data.data[0].summary = '讲 hiddenword 的用法'
		const { client } = clientWith(() => jsonResponse(data))
		expect((await loadSearch(client, 'hiddenword', 1)).items[0]?.snippet).toBe('讲 hiddenword 的用法')
	})

	it('限时公开期内人人能读，照常给片段', async () => {
		const data = fixture('search-premium-body')
		data.data.data[0].meta.paywall.free_until = new Date(Date.now() + 86_400_000).toISOString()
		const { client } = clientWith(() => jsonResponse(data))
		expect((await loadSearch(client, 'hiddenword', 1)).items[0]?.snippet).toContain('hiddenword')
	})
})

describe('时间线', () => {
	it('文章与日记按时间混排，新的在前；日记带专栏名', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('timeline')))
		const entries = await loadTimeline(client)
		const raw = fixture('timeline').data
		expect(entries).toHaveLength(raw.posts.length + raw.notes.length)
		const dates = entries.map(e => Date.parse(e.date))
		expect(dates).toEqual([...dates].sort((a, b) => b - a))
		const note = entries.find(e => e.path === '/notes/2')!
		expect(note).toMatchObject({ type: 'note', title: '周末整理书架', category: '示例专栏', tags: [] })
		expect(entries.find(e => e.type === 'post')!.path).toMatch(/^\/posts\/[\w-]+\/[\w-]+$/)
	})

	it('加密的、未发布的日记不出现', async () => {
		const data = fixture('timeline')
		data.data.notes[0].has_password = true
		data.data.notes[1].is_published = false
		const { client } = clientWith(() => jsonResponse(data))
		expect((await loadTimeline(client)).filter(e => e.type === 'note')).toEqual([])
	})
})

describe('项目与友链', () => {
	it('项目的地址过白名单', async () => {
		const data = fixture('projects-all')
		data.data[1].project_url = 'javascript:alert(1)'
		const { client, requests } = clientWith(() => jsonResponse(data))
		const projects = await loadProjects(client)
		expect(pathOf(requests[0]!)).toBe('/api/v3/projects/all')
		expect(projects[0]).toMatchObject({ name: '示例项目', links: { project: 'https://example.test/project', doc: 'https://example.test/docs' } })
		expect(projects[1]!.links).toEqual({ project: undefined, preview: 'https://example.test/preview', doc: undefined })
	})

	it('友链分组：封禁的不进分组、只留名称，失联的标成不可访问，javascript: 头像丢掉，收藏单独一组', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('links-all')))
		const { groups, banned } = await loadLinkGroups(client)
		// 封禁的只有名字：链接、头像一概不给
		expect(banned).toEqual(['被封的站'])
		expect(JSON.stringify({ groups, banned })).not.toContain('banned.example.test')
		expect(groups.map(g => [g.name, g.entries.map(e => e.author)])).toEqual([
			['友链', ['XSS友链', '失联的站', '示例友站']],
			['收藏', ['收藏的站']],
		])
		const entries = groups.flatMap(g => g.entries)
		expect(entries.find(e => e.author === '失联的站')!.error).toBe('暂时无法访问')
		expect(entries.find(e => e.author === '示例友站')).toMatchObject({ error: undefined, link: 'https://friend.example.test', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
		const xss = entries.find(e => e.author === 'XSS友链')!
		expect(xss.avatar).toBeUndefined()
		expect(xss.icon).toBeUndefined()
		expect(JSON.stringify(groups)).not.toContain('javascript:')
	})

	it('申请开关', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('links-audit')))
		expect(await canApplyLink(client)).toBe(true)
	})
})

describe('友链申请表的校验（parseLinkApplication）', () => {
	const ok = { author: '访客', name: '示例站', url: 'https://a.example.test', avatar: 'https://a.example.test/a.png', description: '简介', email: 'a@example.test' }

	it('合格的申请：空的可选项不带', () => {
		expect(parseLinkApplication({ ...ok, avatar: '', description: ' ', email: '' }))
			.toEqual({ author: '访客', name: '示例站', url: 'https://a.example.test', avatar: undefined, description: undefined, email: undefined })
	})

	it('不合格的一律给提示', () => {
		const bad = [
			{ ...ok, author: '' },
			{ ...ok, name: '站'.repeat(21) },
			{ ...ok, url: 'http://a.example.test' },
			{ ...ok, url: 'javascript:alert(1)' },
			{ ...ok, avatar: 'javascript:alert(1)' },
			{ ...ok, description: '字'.repeat(51) },
			{ ...ok, email: 'not-mail' },
		]
		for (const body of bad)
			expect(typeof parseLinkApplication(body), JSON.stringify(body)).toBe('string')
	})

	it('发给 core 时没填的可选项不带：给 null 会被 core 拒掉（实测）', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { ok: true } }))
		await applyLink(client, { author: '访客', name: '示例站', url: 'https://a.example.test' })
		expect(pathOf(requests[0]!)).toBe('/api/v3/links/audit')
		expect(await requests[0]!.json()).toEqual({ author: '访客', name: '示例站', url: 'https://a.example.test' })
		await applyLink(client, { author: '访客', name: '示例站', url: 'https://a.example.test', description: '简介', email: 'a@example.test' })
		expect(await requests[1]!.json()).toEqual({ author: '访客', name: '示例站', url: 'https://a.example.test', description: '简介', email: 'a@example.test' })
	})

	it.each([
		[{ error: { code: 'DUPLICATE_LINK', message: 'x' } }, 400, '这个站点已经在友链里，或者正在审核'],
		[{ error: { code: 'LINK_APPLY_DISABLED', message: 'x' } }, 403, '站长暂时没有开放友链申请'],
		[{ error: { code: 'SUBPATH_LINK_DISABLED', message: 'x' } }, 422, '只收站点首页的地址，不收子路径'],
		[{ error: { code: 'HTTP_ERROR', message: 'Oh, you have already submitted this friend link' } }, 409, '刚刚已经提交过了，等站长审核吧'],
	])('%j → 固定文案', async (body, status, message) => {
		const { client } = clientWith(() => jsonResponse(body, { status }))
		const failure = await applyLink(client, { author: 'a', name: 'b', url: 'https://c.test' }).catch(classifyMxError)
		expect(linkErrorOf(failure as ReturnType<typeof classifyMxError>).message).toBe(message)
	})
})

describe('独立页', () => {
	it('markdown 独立页走路径 B，危险内容照样剔除；头部没有分类', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('page-about')))
		const detail = await loadPageDetail(client, 'about')
		expect(pathOf(requests[0]!)).toBe('/api/v3/pages/slug/about')
		expect(detail.source).toBe('markdown')
		expect(detail.article).toMatchObject({ title: '关于', description: '关于这个站和我', path: '/about', categories: undefined, tags: [] })
		expect(detail.article.meta?.__id).toBe('183590000000000102')
		const body = JSON.stringify(detail.body)
		expect(body).not.toContain('"script"')
		expect(body).not.toContain('javascript:')
		expect(detail.toc?.links.map(l => l.text)).toEqual(['这个站', '我'])
	})

	it('lexical 独立页走路径 A', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('page-lexical')))
		const detail = await loadPageDetail(client, 'lexical-page')
		expect(detail.source).toBe('lexical')
		expect(detail.toc?.links.map(l => l.text)).toEqual(['起因', '结果'])
	})
})

describe('统计与 sitemap', () => {
	const article = (date: string, words: number, updated?: string) => ({ title: 't', path: '/p', date, updated, readingTime: { words } }) as ArticleProps

	const note = (date: string, nid = 1) => ({ type: 'note', id: String(nid), title: `日记${nid}`, path: `/notes/${nid}`, date, tags: [] }) as TimelineEntry
	const NOW = Date.parse('2026-09-25T00:00:00Z')

	it('字数、每年分布、阅读与点赞照文章列表算，日记篇数照时间线算，不打 core', () => {
		const withCounts = { ...article('2024-06-01T00:00:00Z', 50, '2026-09-01T00:00:00Z'), readCount: 10, likeCount: 2 }
		const stats = statsFrom([article('2024-05-01T00:00:00Z', 100), withCounts, article('2022-05-01T00:00:00Z', 7)], [note('2021-01-01T00:00:00Z'), note('2026-09-01T00:00:00Z', 2)], 'Asia/Shanghai')
		expect(stats.total).toEqual({ posts: 3, notes: 2, words: 157, reads: 10, likes: 2 })
		expect(stats.annual).toEqual({ 2024: { posts: 2, words: 150 }, 2022: { posts: 1, words: 7 } })
		expect(stats.updated).toBe('2026-09-01T00:00:00Z')
		// 主题配置没填建站日期时，「运营时长」从最早一篇公开的文章或日记算
		expect(stats.firstPublished).toBe('2021-01-01T00:00:00Z')
	})

	it('付费文章的字数只按预览算、不准，不计入总字数与每年字数，篇数照算', () => {
		const premium = { ...article('2024-05-01T00:00:00Z', 30), premium: true }
		const stats = statsFrom([article('2024-06-01T00:00:00Z', 100), premium], [], 'Asia/Shanghai')
		expect(stats.total).toMatchObject({ posts: 2, words: 100 })
		expect(stats.annual['2024']).toEqual({ posts: 2, words: 100 })
		expect(countedWordsOf(premium)).toBe(0)
	})

	it('每年的分布按站点时区分年：UTC 的年末最后几个小时在东八区已是第二年', () => {
		const items = [article('2024-12-31T20:00:00Z', 10)]
		expect(Object.keys(statsFrom(items, [], 'Asia/Shanghai').annual)).toEqual(['2025'])
		expect(Object.keys(statsFrom(items, [], 'UTC').annual)).toEqual(['2024'])
	})

	it('阅读最多把日记也算进来', () => {
		const top = topReadFrom([{ ...article('2024-05-01T00:00:00Z', 1), path: '/posts/a/b', title: '文章', readCount: 5 }], [{ ...note('2024-01-01T00:00:00Z', 3), readCount: 9 }])
		expect(top.map(item => [item.path, item.count])).toEqual([['/notes/3', 9], ['/posts/a/b', 5]])
	})

	it('新内容：since 之后的公开文章与日记，since 夹在 30 天内；非数字当没有', () => {
		const list = [{ ...article('2026-09-20T00:00:00Z', 1), path: '/posts/a/new', title: '新文章' }, { ...article('2026-01-01T00:00:00Z', 1), path: '/posts/a/old', title: '旧文章' }]
		const updates = updatesSince(list, [note('2026-09-24T00:00:00Z', 7)], Date.parse('2026-09-10T00:00:00Z'), NOW)
		expect(updates).toEqual({ count: 2, items: [{ title: '日记7', path: '/notes/7', date: '2026-09-24T00:00:00Z' }, { title: '新文章', path: '/posts/a/new', date: '2026-09-20T00:00:00Z' }] })
		// 一年前来过：只算最近 30 天
		expect(updatesSince(list, [], 0, NOW).count).toBe(1)
		// 浏览器时钟在未来：没有新内容
		expect(updatesSince(list, [], NOW + 86_400_000, NOW).count).toBe(0)
		expect(updatesSince(list, [], Number.NaN, NOW).count).toBe(0)
	})

	it('前后的日记：按时间排，前后各 5 篇；不在时间线里（加密、未公开）两边都空', () => {
		const notes = Array.from({ length: 12 }, (_, i) => note(`2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, i + 1))
		const around = noteNeighborsOf([...notes, { ...note('2026-01-05T00:00:00Z', 99), type: 'post', path: '/posts/x/y' }], 6)
		expect(around.newer.map(item => item.path)).toEqual(['/notes/7', '/notes/8', '/notes/9', '/notes/10', '/notes/11'])
		expect(around.older.map(item => item.path)).toEqual(['/notes/5', '/notes/4', '/notes/3', '/notes/2', '/notes/1'])
		expect(noteNeighborsOf(notes, 404)).toEqual({ newer: [], older: [] })
	})

	it('sitemap 只取路径，丢掉 mx 的 webUrl', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('sitemap')))
		const entries = await loadSitemapEntries(client)
		expect(entries.map(e => e.loc)).toContain('/posts/tech/hello-world')
		expect(entries.map(e => e.loc)).toContain('/about')
		expect(entries.every(e => e.loc.startsWith('/') && !e.loc.includes('localhost'))).toBe(true)
		expect(entries[0]!.lastmod).toMatch(/^\d{4}-/)
	})
})
