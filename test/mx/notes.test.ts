import { describe, expect, it } from 'vitest'
import { excerptOf, noteFromModel } from '../../app/utils/mx/adapter'
import { isScheduled, loadNoteDetail, loadNotePage, loadSayPage, loadThinking, loadThinkingItem, loadTopicDetail, THINKING_PAGE_SIZE } from '../../app/utils/mx/notes'
import { clientWith, fixture, jsonResponse } from './helpers'

const pathOf = (request: Request) => new URL(request.url).pathname

describe('日记：NoteModel → NoteProps', () => {
	it('日记详情的各字段', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('note-detail')))
		const note = noteFromModel(await client.note.getNoteByNid(2))
		expect(note).toMatchObject({
			nid: 2,
			title: '周末整理书架',
			mood: '开心',
			weather: '晴',
			path: '/notes/2',
			topic: { name: '示例专栏', slug: 'sample-topic', path: '/notes/series/sample-topic' },
		})
		expect(note.excerpt).toMatch(/^起因 周末整理书架/)
		expect(note.excerpt).not.toContain('wc -l')
		expect(note.meta.__id).toBeTruthy()
	})
})

describe('摘要 excerptOf', () => {
	it('去掉代码块、图片与标记，链接只留文字', () => {
		const text = ['## 标题', '', '正文 **粗** [链接](https://a.test) ![图](https://i.test/a.png)', '', '```sh', 'secret-command', '```', '', '~~~', 'tilde-fence', '~~~', '- 列表项'].join('\n')
		expect(excerptOf(text)).toBe('标题 正文 粗 链接 列表项')
	})

	it('超长截断并加省略号；没闭合的围栏之后都跳过', () => {
		expect(excerptOf('字'.repeat(200), 10)).toBe(`${'字'.repeat(10)}…`)
		expect(excerptOf('开头\n```\n后面全是代码')).toBe('开头')
	})
})

describe('日记详情', () => {
	it('mx 的 prev 是更新的一篇、next 是更早的一篇', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('note-detail')))
		const detail = await loadNoteDetail(client, 2)
		expect(detail.locked).toBe(false)
		if (detail.locked || 'scheduled' in detail)
			return
		expect(detail.older?.nid).toBe(1)
		expect(detail.newer).toBeUndefined()
		expect(detail.source).toBe('lexical')
		expect(detail.toc?.links.map(l => l.text)).toEqual(['起因', '结果'])
	})

	it('加密日记的 403 NOTE_FORBIDDEN 转成 locked，不当成错误', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('error-403-note'), { status: 403 }))
		expect(await loadNoteDetail(client, 3)).toEqual({ locked: true, nid: 3 })
	})

	it('带密码时作为查询参数发给 core（core 只认这种写法）', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('note-detail')))
		await loadNoteDetail(client, 3, 'p@ss')
		expect(new URL(requests[0]!.url).searchParams.get('password')).toBe('p@ss')
	})

	it('定时公开、还没到时间：标题和正文都不下发，只给公开时间（core 对游客只清空了 text，content 还在）', async () => {
		const raw = fixture('note-detail')
		raw.data.public_at = '2030-01-01T00:00:00.000Z'
		raw.data.text = ''
		const { client } = clientWith(() => jsonResponse(raw))
		const detail = await loadNoteDetail(client, 2, undefined, Date.parse('2029-12-31T00:00:00.000Z'))
		expect(detail).toEqual({ locked: false, scheduled: true, nid: 2, publicAt: '2030-01-01T00:00:00.000Z' })
		expect(JSON.stringify(detail)).not.toContain(fixture('note-detail').data.title)
	})

	it('公开时间已过：照常渲染', async () => {
		const raw = fixture('note-detail')
		raw.data.public_at = '2030-01-01T00:00:00.000Z'
		const { client } = clientWith(() => jsonResponse(raw))
		const detail = await loadNoteDetail(client, 2, undefined, Date.parse('2030-01-01T00:00:01.000Z'))
		expect(detail).toMatchObject({ locked: false, source: 'lexical' })
		expect(isScheduled(null, 0)).toBe(false)
		expect(isScheduled('不是日期', 0)).toBe(false)
	})

	it('其他错误照常抛出', async () => {
		const { client } = clientWith(() => jsonResponse({ error: { code: 'NOTE_NOT_FOUND', message: 'x' } }, { status: 404 }))
		await expect(loadNoteDetail(client, 999)).rejects.toMatchObject({ status: 404 })
	})
})

describe('列表', () => {
	it('日记列表按页', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('notes-page')))
		const page = await loadNotePage(client, 1)
		expect(page).toMatchObject({ page: 1, totalPages: 1, total: 2 })
		expect(page.items.map(n => n.nid)).toEqual([2, 1])
		expect(new URL(requests[0]!.url).searchParams.get('size')).toBe('10')
	})

	it('专栏详情：先按 slug 取专栏，再按专栏 id 取日记', async () => {
		const { client, requests } = clientWith(req => pathOf(req).includes('/topics/slug/')
			? jsonResponse(fixture('topic-detail'))
			: jsonResponse(fixture('notes-page')))
		const detail = await loadTopicDetail(client, 'sample-topic', 1)
		expect(detail.topic).toMatchObject({ name: '示例专栏', path: '/notes/series/sample-topic' })
		expect(requests.map(pathOf)).toEqual(['/api/v3/topics/slug/sample-topic', `/api/v3/notes/topics/${fixture('topic-detail').data.id}`])
	})

	it('说说：纯文本字段，作者与出处可缺', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('says-page')))
		const page = await loadSayPage(client, 1)
		expect(page.items).toHaveLength(3)
		expect(page.items.find(s => s.source)).toMatchObject({ text: '少即是多。', source: '建筑箴言' })
		expect(page.items.find(s => !s.author)?.author).toBeUndefined()
	})

	it('碎碎念：正文按 markdown 渲染，地址过白名单，不满一页时没有下一页游标', async () => {
		const list = fixture('recently-list')
		list.data[0].metadata = { url: 'javascript:alert(1)' }
		const { client } = clientWith(() => jsonResponse(list))
		const { items, next } = await loadThinking(client)
		expect(items).toHaveLength(3)
		expect(next).toBeUndefined()
		expect(items[0]!.link).toBeUndefined()
		expect(items[1]!.link).toBe('https://example.test/project')
		expect(JSON.stringify(items[0]!.body)).toContain('"strong"')
	})

	it('碎碎念：满一页时用最后一条的 id 当游标', async () => {
		const base = fixture('recently-list').data[0]
		const data = Array.from({ length: THINKING_PAGE_SIZE }, (_, i) => ({ ...base, id: String(1000 + i) }))
		const { client, requests } = clientWith(() => jsonResponse({ data }))
		const { next } = await loadThinking(client, '5000')
		expect(next).toBe('1009')
		expect(new URL(requests[0]!.url).searchParams.get('before')).toBe('5000')
	})

	it('单条碎碎念：core 查不到时回 200 的 data: null，当作不存在而不是出错', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: null }))
		expect(await loadThinkingItem(client, '12345')).toBeUndefined()
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/recently/12345')
		const found = clientWith(() => jsonResponse(fixture('recently-item')))
		expect((await loadThinkingItem(found.client, '1'))?.body).toBeTruthy()
	})
})
