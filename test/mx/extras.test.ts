import { describe, expect, it } from 'vitest'
import { thinkingFields } from '../../app/utils/mx/adapter'
import { contentExtrasOf } from '../../app/utils/mx/extras'
import { loadNoteNidByDate, loadTopicDetail, noteDatePathOf } from '../../app/utils/mx/notes'
import { themeConfigFrom } from '../../app/utils/mx/theme'
import { clientWith, fixture, jsonResponse } from './helpers'

const pathOf = (request: Request) => new URL(request.url).pathname

describe('文章与日记的附加信息', () => {
	it('公告：五种样式对到四种，文字限长，className 丢掉', () => {
		expect(contentExtrasOf({ banner: { type: 'success', message: '好消息', className: 'evil' } }, undefined)?.banner).toEqual({ type: 'tip', message: '好消息' })
		expect(contentExtrasOf({ banner: { type: 'secondary', message: 'x' } }, undefined)?.banner?.type).toBe('info')
		expect(contentExtrasOf({ banner: { type: 'nope', message: 'x' } }, undefined)?.banner?.type).toBe('info')
		expect(contentExtrasOf({ banner: { type: 'warning', message: 'a'.repeat(900) } }, undefined)?.banner?.message).toHaveLength(500)
		expect(contentExtrasOf({ banner: { type: 'info' } }, undefined)).toBeUndefined()
	})

	it('aI 参与声明：译成中文；-1 是纯手写；含 2 标成全文生成；自定义字符串原样；认不得的丢掉', () => {
		expect(contentExtrasOf({ aiGen: [1, 5] }, undefined)?.aiGen).toEqual({ labels: ['润色', '校对'], handcrafted: false, full: false })
		expect(contentExtrasOf({ aiGen: -1 }, undefined)?.aiGen).toEqual({ labels: ['纯手写'], handcrafted: true, full: false })
		expect(contentExtrasOf({ aiGen: 2 }, undefined)?.aiGen).toMatchObject({ full: true })
		expect(contentExtrasOf({ aiGen: ['自己审校', 99, null] }, undefined)?.aiGen?.labels).toEqual(['自己审校'])
		expect(contentExtrasOf({ aiGen: 'x'.repeat(40) }, undefined)?.aiGen?.labels[0]).toHaveLength(20)
		expect(contentExtrasOf({ aiGen: [] }, undefined)).toBeUndefined()
	})

	it('aI 摘要只取文字、限长；付费文章锁着时不给', () => {
		const $meta = { summary: { id: '1', text: '  这是 AI 摘要  ', lang: 'zh' } }
		expect(contentExtrasOf({}, $meta)?.aiSummary).toBe('这是 AI 摘要')
		expect(contentExtrasOf({}, $meta, { locked: true })).toBeUndefined()
		expect(contentExtrasOf({}, { summary: { text: 42 } })).toBeUndefined()
	})

	it('相关文章：用分类 slug 加 slug 拼地址并编码，缺字段的丢掉', () => {
		const related = contentExtrasOf({}, { related: [
			{ id: '1', title: '另一篇', slug: 'a b', summary: '摘要', category: { name: '工具', slug: 'tools' } },
			{ id: '2', title: '没有分类', slug: 'x' },
			'坏的',
		] })?.related
		expect(related).toEqual([{ title: '另一篇', path: '/posts/tools/a%20b', summary: '摘要' }])
	})

	it('skill 包：名称、说明；认得出名称的进本站的 Skill 页，认不出的退回原文件地址（只收 http(s)）', () => {
		const skills = contentExtrasOf({}, { skills: [
			{ id: '1', name: 'demo-skill', description: '示例', rawUrl: 'https://blog.example.com/api/v3/s/sk/demo/SKILL.md' },
			{ id: '2', name: 'bad', rawUrl: 'javascript:alert(1)' },
			{ id: '3' },
			{ id: '4', name: 'other', rawUrl: 'https://cdn.example.com/other.md' },
		] })?.skills
		expect(skills).toEqual([
			{ name: 'demo-skill', description: '示例', url: '/skills/demo' },
			{ name: 'bad', description: '' },
			{ name: 'other', description: '', url: 'https://cdn.example.com/other.md' },
		])
	})

	it('什么都没有就是 undefined', () => {
		expect(contentExtrasOf(undefined, undefined)).toBeUndefined()
		expect(contentExtrasOf({ cover: 'https://x' }, { paywall: {} })).toBeUndefined()
	})
})

describe('碎碎念的引用与情境', () => {
	const base = { id: '1', createdAt: '2022-01-01T00:00:00Z', content: 'x' }

	it('引用只收站内路径；类型译成页面上的名字', () => {
		expect(thinkingFields({ ...base, ref: { id: '9', type: 'note', title: '一篇日记', url: '/notes/3' } } as never).quoted).toEqual({ title: '一篇日记', path: '/notes/3', kind: 'note' })
		expect(thinkingFields({ ...base, ref: { type: 'post', title: 'x', url: 'https://evil.example/' } } as never).quoted).toBeUndefined()
		expect(thinkingFields({ ...base, ref: { type: 'post', title: 'x', url: '//evil.example/' } } as never).quoted).toBeUndefined()
		expect(thinkingFields({ ...base, ref: { type: 'unknown', url: '/a' } } as never).quoted).toBeUndefined()
	})

	it('companion 发布的条目带上应用、窗口与在放的歌；别的条目没有', () => {
		const metadata = { kind: 'companion-moment', application: { displayName: 'VS Code', window: { title: 'README.md' } }, media: { title: '某首歌', artist: '某歌手' } }
		expect(thinkingFields({ ...base, metadata } as never).context).toEqual({ app: 'VS Code', window: 'README.md', media: '某首歌 - 某歌手' })
		expect(thinkingFields({ ...base, metadata: { url: 'https://example.com' } } as never).context).toBeUndefined()
	})
})

describe('日期加 slug 的日记地址', () => {
	it('年月日按整数校验，slug 挡住点段与改写路径的字符', () => {
		expect(noteDatePathOf('2024', '5', '01', 'hello')).toEqual({ year: 2024, month: 5, day: 1, slug: 'hello' })
		for (const args of [['24x', '5', '1', 'a'], ['2024', '13', '1', 'a'], ['2024', '5', '32', 'a'], ['2024', '5', '1', '..'], ['2024', '5', '1', '%2e%2e'], ['2024', '5', '1', 'a/b'], ['2024', '5', '1', undefined]])
			expect(noteDatePathOf(...args), args.join(',')).toBeUndefined()
	})

	it('查到的是 core 的日记：取出 nid', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('note-detail')))
		expect(await loadNoteNidByDate(client, { year: 2024, month: 5, day: 1, slug: 'hello' })).toBe(fixture('note-detail').data.nid)
		expect(pathOf(requests[0]!)).toBe('/api/v3/notes/2024/5/1/hello')
	})
})

describe('专栏的描述按 markdown 渲染', () => {
	it('详情带渲染好的正文；列表用的 description 是纯文本', async () => {
		const topic = { ...fixture('topic-detail'), data: { ...fixture('topic-detail').data, description: '这是**加粗**的描述\n\n- 第一点' } }
		const { client } = clientWith(request => jsonResponse(pathOf(request).includes('/topics/slug/') ? topic : fixture('notes-page')))
		const detail = await loadTopicDetail(client, 'sample-topic', 1)
		expect(detail.topic.description).toBe('这是加粗的描述 第一点')
		expect(JSON.stringify(detail.descriptionBody)).toContain('"tag":"strong"')
	})
})

describe('过时提醒的天数', () => {
	it('默认 365，0 表示不提醒，超出范围退回默认', () => {
		expect(themeConfigFrom({}).config.outdatedDays).toBe(365)
		expect(themeConfigFrom({ outdatedDays: 0 }).config.outdatedDays).toBe(0)
		expect(themeConfigFrom({ outdatedDays: 90 }).config.outdatedDays).toBe(90)
		expect(themeConfigFrom({ outdatedDays: -1 }).config.outdatedDays).toBe(365)
		expect(themeConfigFrom({ outdatedDays: 1.5 }).config.outdatedDays).toBe(365)
	})
})
