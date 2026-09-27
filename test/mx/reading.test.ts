/**
 * 阅读体验：朗读分段的块 id、阅读位置的分组、预览的 `?peek-to`、时间线日记的心情与天气
 */
import { describe, expect, it } from 'vitest'
import { timelineFrom } from '../../app/utils/mx/adapter'
import { ttsSegmentsFrom } from '../../app/utils/mx/tts'
import { groupPresence, presenceLabelOf } from '../../app/utils/presence-groups'
import { peekToPathOf, withPeekTo } from '../../shared/utils/peek'

describe('朗读分段', () => {
	it('带上格式合格的块 id，别的不收', () => {
		expect(ttsSegmentsFrom({ segments: [
			{ text: '一', url: 'https://cdn.example.test/1.mp3', blockId: 'twbEKUdO' },
			{ text: '二', url: 'https://cdn.example.test/2.mp3', blockId: 'bad id"' },
			{ text: '三', url: 'https://cdn.example.test/3.mp3' },
		] })).toEqual([
			{ text: '一', url: 'https://cdn.example.test/1.mp3', blockId: 'twbEKUdO' },
			{ text: '二', url: 'https://cdn.example.test/2.mp3' },
			{ text: '三', url: 'https://cdn.example.test/3.mp3' },
		])
	})
})

describe('阅读位置的分组', () => {
	const reader = (identity: string, position: number, name = identity) => ({ identity, position, name })

	it('轨道 600px 时阈值 60px（10%）：40、45、48 合成一组，位置取平均；80 单独一组', () => {
		const groups = groupPresence([reader('b', 45), reader('a', 40), reader('c', 80), reader('d', 48)], 600)
		expect(groups.map(group => ({ key: group.key, position: group.position, size: group.members.length }))).toEqual([
			{ key: 'a', position: 44, size: 3 },
			{ key: 'c', position: 80, size: 1 },
		])
	})

	it('轨道很矮时阈值至少 18px；和组里第一个人比，不是和上一个人比', () => {
		// 90px 高：18px 就是 20%
		expect(groupPresence([reader('a', 0), reader('b', 15), reader('c', 30)], 90).map(group => group.members.length)).toEqual([2, 1])
	})

	it('名单最多列 5 个，其余写「及其他 N 人」', () => {
		const [group] = groupPresence(Array.from({ length: 7 }, (_, i) => reader(`r${i}`, 50, `读者${i}`)), 600)
		expect(presenceLabelOf(group!)).toEqual(['读者0 · 50%', '读者1 · 50%', '读者2 · 50%', '读者3 · 50%', '读者4 · 50%', '及其他 2 人'])
	})
})

describe('预览的 peek-to', () => {
	it('只认本站的文章与日记路径', () => {
		expect(peekToPathOf('/posts/tech/a')).toBe('/posts/tech/a')
		expect(peekToPathOf('/notes/3?x=1')).toBe('/notes/3')
		for (const bad of ['https://evil.test/posts/a/b', '//evil.test/posts/a/b', '/posts/tag/a', '/about', '/notes/0', 'posts/a/b', undefined, ['/notes/3']])
			expect(peekToPathOf(bad), String(bad)).toBeUndefined()
	})

	it('加上、去掉参数，别的参数与锚点原样', () => {
		const opened = withPeekTo('https://blog.example.test/?category=x#top', '/posts/tech/a')
		expect(opened).toBe('https://blog.example.test/?category=x&peek-to=%2Fposts%2Ftech%2Fa#top')
		expect(withPeekTo(opened, undefined)).toBe('https://blog.example.test/?category=x#top')
	})
})

describe('时间线的日记', () => {
	it('带心情与天气（去掉首尾空白、限 20 字，没有就不带）', () => {
		const [entry] = timelineFrom({ notes: [{ id: '1', nid: 3, title: '日记', createdAt: '2026-09-01T00:00:00Z', mood: ' 平静 ', weather: '晴'.repeat(30) } as never] })
		expect(entry).toMatchObject({ mood: '平静', weather: '晴'.repeat(20) })
		const [plain] = timelineFrom({ notes: [{ id: '2', nid: 4, title: '日记', createdAt: '2026-09-01T00:00:00Z', mood: '', weather: null } as never] })
		expect(plain!.mood).toBeUndefined()
		expect(plain!.weather).toBeUndefined()
	})
})
