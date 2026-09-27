/**
 * 划词评论：块文字、锚点的校验与重建、评论上显示的引用、正文里的块 id
 */
import type { MDCElement } from '@nuxtjs/mdc'
import { describe, expect, it } from 'vitest'
import { anchorBlocksOf, anchorHighlightOf, buildAnchor, commentAnchorOf, parseAnchorInput, pickOccurrence } from '../../app/utils/mx/anchor'
import { commentFromModel, parseCommentDraft } from '../../app/utils/mx/comments'
import { renderLexicalBody } from '../../app/utils/mx/lexical'

const text = (value: string) => ({ type: 'text', text: value })
const block = (type: string, blockId: string | undefined, children: unknown[], extra: Record<string, unknown> = {}) => ({ type, children, ...(blockId ? { $: { blockId } } : {}), ...extra })
const STATE = {
	root: {
		type: 'root',
		children: [
			block('paragraph', 'b1', [text('第一段有个'), { type: 'link', url: 'https://example.test', children: [text('链接')] }, { type: 'linebreak' }, text('第二行')]),
			block('heading', 'b2', [text('标题')], { tag: 'h2' }),
			block('paragraph', 'b3', [text('重复的词，重复的词，还是重复的词')]),
			block('code-block', 'b4', [], { code: 'const x = 1', language: 'js' }),
			block('paragraph', undefined, [text('没有块 id 的段落')]),
			block('list', 'b5', [{ type: 'listitem', children: [text('一项')] }, { type: 'listitem', children: [text('二项')] }], { listType: 'bullet' }),
			block('paragraph', 'b1', [text('重复的块 id 只认第一个')]),
		],
	},
}

describe('块文字', () => {
	it('只收段落、标题、引用、列表；文字照 core 的算法（换行是 \\n，子节点直接拼接）；重复的 id 只认第一个', () => {
		const blocks = anchorBlocksOf(STATE)
		expect(Object.keys(blocks)).toEqual(['b1', 'b2', 'b3', 'b5'])
		expect(blocks.b1).toEqual({ type: 'paragraph', text: '第一段有个链接\n第二行' })
		expect(blocks.b5!.text).toBe('一项二项')
	})

	it('块 id 的格式不对当作没有', () => {
		expect(Object.keys(anchorBlocksOf({ root: { children: [block('paragraph', 'bad id"', [text('x')]), block('paragraph', 'x'.repeat(129), [text('y')])] } }))).toEqual([])
	})
})

describe('锚点', () => {
	const blocks = anchorBlocksOf(STATE)

	it('浏览器交来的：块 id、引用 1–200 字、前后文截到 50 字；不合格的是 null', () => {
		expect(parseAnchorInput(undefined)).toBeUndefined()
		expect(parseAnchorInput({ blockId: 'b1', quote: '链接', prefix: 'x'.repeat(80), suffix: 'y'.repeat(80) })).toEqual({ blockId: 'b1', quote: '链接', prefix: 'x'.repeat(50), suffix: 'y'.repeat(50) })
		for (const bad of [{ blockId: 'b1', quote: '' }, { blockId: 'b1', quote: '  ' }, { blockId: 'b 1', quote: 'x' }, { blockId: 'b1', quote: 'x'.repeat(201) }, { quote: 'x' }, 'b1'])
			expect(parseAnchorInput(bad), JSON.stringify(bad)).toBeNull()
	})

	it('段落锚点：只要块 id；重建成 core 的 block 锚点（类型与快照按正文）', () => {
		expect(parseAnchorInput({ mode: 'block', blockId: 'b2', quote: '忽略' })).toEqual({ blockId: 'b2', mode: 'block', quote: '', prefix: '', suffix: '' })
		expect(parseAnchorInput({ mode: 'block', blockId: 'bad id' })).toBeNull()
		expect(buildAnchor(blocks, { blockId: 'b2', mode: 'block', quote: '', prefix: '', suffix: '' })).toEqual({ mode: 'block', blockId: 'b2', blockType: 'heading', snapshotText: '标题' })
		expect(buildAnchor(blocks, { blockId: 'b4', mode: 'block', quote: '', prefix: '', suffix: '' })).toBeUndefined()
	})

	it('按正文重建：偏移、前后文、快照都按正文算，不用浏览器的', () => {
		expect(buildAnchor(blocks, { blockId: 'b1', quote: '链接\n第二', prefix: '伪造的前文', suffix: '伪造的后文' })).toEqual({
			mode: 'range',
			blockId: 'b1',
			blockType: 'paragraph',
			quote: '链接\n第二',
			prefix: '第一段有个',
			suffix: '行',
			startOffset: 5,
			endOffset: 10,
			snapshotText: '第一段有个链接\n第二行',
		})
	})

	it('引用不在块里、块不存在、块不能评论（代码块、没有 id）时重建不出来', () => {
		expect(buildAnchor(blocks, { blockId: 'b1', quote: '原文里没有', prefix: '', suffix: '' })).toBeUndefined()
		expect(buildAnchor(blocks, { blockId: 'nope', quote: '标题', prefix: '', suffix: '' })).toBeUndefined()
		expect(buildAnchor(blocks, { blockId: 'b4', quote: 'const', prefix: '', suffix: '' })).toBeUndefined()
		// 另一块里的字不能挂在这一块上
		expect(buildAnchor(blocks, { blockId: 'b2', quote: '第一段', prefix: '', suffix: '' })).toBeUndefined()
	})

	it('引用重复出现时按前后文挑', () => {
		const t = '重复的词，重复的词，还是重复的词'
		expect(pickOccurrence(t, '重复的词')).toEqual({ index: 0, start: 0 })
		expect(pickOccurrence(t, '重复的词', '重复的词，', '，还是')).toEqual({ index: 1, start: 5 })
		expect(pickOccurrence(t, '重复的词', '还是', '')).toEqual({ index: 2, start: 12 })
		expect(buildAnchor(blocks, { blockId: 'b3', quote: '重复的词', prefix: '还是', suffix: '' })).toMatchObject({ startOffset: 12, endOffset: 16 })
	})
})

describe('评论上的引用', () => {
	const blocks = anchorBlocksOf(STATE)
	const range = (extra: Record<string, unknown> = {}) => ({ mode: 'range', blockId: 'b2', quote: '标题', prefix: '', suffix: '', startOffset: 0, endOffset: 2, ...extra })

	it('引用还在正文里：给块 id 与引用；不在了只说不在（不再显示引用本身）', () => {
		expect(commentAnchorOf(range(), blocks)).toEqual({ blockId: 'b2', quote: '标题' })
		expect(commentAnchorOf(range({ quote: '改掉了的字' }), blocks)).toEqual({ stale: true })
		expect(commentAnchorOf(range({ blockId: 'gone' }), blocks)).toEqual({ stale: true })
		expect(JSON.stringify(commentAnchorOf(range({ quote: '后来锁起来的付费内容' }), blocks))).not.toContain('付费')
	})

	it('没有正文可比、认不出的锚点、没有锚点时不显示', () => {
		expect(commentAnchorOf(range(), undefined)).toBeUndefined()
		expect(commentAnchorOf({ mode: 'block', blockId: 'b2' }, undefined)).toBeUndefined()
		expect(commentAnchorOf({ mode: 'other', blockId: 'b2' }, blocks)).toBeUndefined()
		expect(commentAnchorOf(null, blocks)).toBeUndefined()
	})

	it('段落评论：块还在就给块的前 40 字，不在就说段落已不在', () => {
		expect(commentAnchorOf({ mode: 'block', blockId: 'b1' }, blocks)).toEqual({ blockId: 'b1', block: '第一段有个链接 第二行' })
		expect(commentAnchorOf({ mode: 'block', blockId: 'b3' }, anchorBlocksOf({ root: { children: [block('paragraph', 'b3', [text('长'.repeat(60))])] } }))).toEqual({ blockId: 'b3', block: `${'长'.repeat(40)}…` })
		expect(commentAnchorOf({ mode: 'block', blockId: 'gone' }, blocks)).toEqual({ stale: true, mode: 'block' })
		expect(anchorHighlightOf('7', { mode: 'block', blockId: 'b1' }, blocks)).toEqual({ id: '7', blockId: 'b1', mode: 'block', quote: '', index: 0 })
	})

	it('评论映射：只有顶层评论带引用，核对用传入的正文块', () => {
		const base = { id: '1', author: '读者', text: '好', createdAt: '2026-09-25T00:00:00Z', anchor: range() }
		expect(commentFromModel(base as never, { anchorBlocks: blocks }).anchor).toEqual({ blockId: 'b2', quote: '标题' })
		expect(commentFromModel({ ...base, parentCommentId: '0', rootCommentId: '0' } as never, { anchorBlocks: blocks }).anchor).toBeUndefined()
		expect(commentFromModel(base as never).anchor).toBeUndefined()
	})

	it('正文高亮：按 core 存的前后文算是第几处', () => {
		expect(anchorHighlightOf('9', { mode: 'range', blockId: 'b3', quote: '重复的词', prefix: '还是', suffix: '' }, blocks)).toEqual({ id: '9', blockId: 'b3', quote: '重复的词', index: 2 })
		expect(anchorHighlightOf('9', range({ quote: '没了' }), blocks)).toBeUndefined()
	})
})

describe('发评论', () => {
	const guest = { author: '读者', mail: 'reader@example.test' }

	it('顶层评论能带锚点，回复不能；锚点不合格给固定提示', () => {
		expect(parseCommentDraft({ text: '好', as: 'guest', guest, anchor: { blockId: 'b1', quote: '链接' } })).toMatchObject({ anchor: { blockId: 'b1', quote: '链接', prefix: '', suffix: '' } })
		expect(parseCommentDraft({ text: '好', as: 'guest', guest, parentId: '1', anchor: { blockId: 'b1', quote: '链接' } })).toBe('选中的文字不对，请重新选一次')
		expect(parseCommentDraft({ text: '好', as: 'guest', guest, anchor: { blockId: 'b1', quote: '' } })).toBe('选中的文字不对，请重新选一次')
		expect(parseCommentDraft({ text: '好', as: 'guest', guest })).not.toHaveProperty('anchor.blockId')
	})
})

describe('正文里的块 id', () => {
	it('段落、标题、列表转出来正好一个元素时带 data-block-id；代码块、没有 id 的不带', async () => {
		const { body } = await renderLexicalBody(STATE as never)
		const ids = (body.children as MDCElement[]).map(node => [node.tag, node.props?.['data-block-id']])
		expect(ids).toEqual(expect.arrayContaining([['p', 'b1'], ['h2', 'b2'], ['p', 'b3'], ['ul', 'b5']]))
		expect(JSON.stringify(body)).not.toContain('"data-block-id":"b4"')
		expect(JSON.stringify(body).match(/"data-block-id":"b1"/g)).toHaveLength(1)
		expect((body.children as MDCElement[]).filter(node => node.props?.['data-block-id'] === undefined).map(node => node.tag)).toContain('p')
	})
})
