import { describe, expect, it } from 'vitest'
import { splitHighlight } from '../../shared/utils/str'

describe('搜索高亮按文字片段切，不拼 HTML', () => {
	it('命中的词单独成段，大小写不敏感', () => {
		expect(splitHighlight('Nuxt 与 nuxt', 'NUXT')).toEqual([
			{ text: 'Nuxt', hit: true },
			{ text: ' 与 ', hit: false },
			{ text: 'nuxt', hit: true },
		])
	})

	it('长词优先：「数据库」不会被「数据」截断', () => {
		expect(splitHighlight('查数据库', ['数据', '数据库'])).toEqual([
			{ text: '查', hit: false },
			{ text: '数据库', hit: true },
		])
	})

	it('含 HTML 与正则元字符时按字面处理', () => {
		const parts = splitHighlight('<script>alert(1)</script> a.b', ['(1)', '.'])
		expect(parts.map(p => p.text).join('')).toBe('<script>alert(1)</script> a.b')
		expect(parts.filter(p => p.hit).map(p => p.text)).toEqual(['(1)', '.'])
	})

	it('没有命中词时整段原样', () => {
		expect(splitHighlight('标题', [' ', ''])).toEqual([{ text: '标题', hit: false }])
		expect(splitHighlight('标题', undefined)).toEqual([{ text: '标题', hit: false }])
	})
})
