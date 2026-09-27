/**
 * 划词评论的锚点（core 的 `anchor`，mode = range）。纯模块：服务端按匿名正文算好正文块，浏览器发划词评论时据此重建锚点。
 *
 * core 对锚点什么都不查：块 id、引用、偏移都是评论者自己填的，所以由主题替它校验、重建——
 * 以**匿名身份**取来的正文为准（付费锁定的部分不在里面），引用必须在那一块的文字里，
 * 偏移、前后文、快照全按正文重算，不用浏览器交来的。
 *
 * 只对 Lexical 正文的段落、标题、引用、列表开放（路径 A 给这几种块的输出加 `data-block-id`）。
 * 块文字照 core `extractBlockText` 对这几种块的算法：文本节点原样、换行是 `\n`、子节点直接拼接，别的行内节点不算字
 */
import type { CommentAnchor, CommentAnchorDraft } from '../../types/comment'
import { objectField } from './validate'

export const ANCHOR_BLOCK_TYPES = new Set(['paragraph', 'heading', 'quote', 'list'])
export const BLOCK_ID = /^[\w-]{1,128}$/
export const QUOTE_MAX = 200
const CONTEXT_MAX = 50
const SNAPSHOT_MAX = 300

interface LexicalLike {
	type?: unknown
	text?: unknown
	children?: unknown
	$?: unknown
}

/** 根节点上 core 写的块 id（`$.blockId`）；格式不对的当作没有 */
export function blockIdOf(node: unknown) {
	const id = objectField(objectField(node).$).blockId
	return typeof id === 'string' && BLOCK_ID.test(id.trim()) ? id.trim() : undefined
}

export function blockTextOf(node: unknown): string {
	const item = objectField(node) as LexicalLike
	if (item.type === 'text')
		return typeof item.text === 'string' ? item.text : ''
	if (item.type === 'linebreak')
		return '\n'
	return Array.isArray(item.children) ? item.children.map(blockTextOf).join('') : ''
}

export interface AnchorBlock {
	type: string
	text: string
}

/** 编辑器状态 → 可以划词评论的块：块 id → 类型与文字（重复的 id 只认第一个，与 core 规整时一致） */
export function anchorBlocksOf(state: unknown): Record<string, AnchorBlock> {
	const children = objectField(objectField(state).root).children
	const blocks: Record<string, AnchorBlock> = {}
	for (const child of Array.isArray(children) ? children : []) {
		const type = objectField(child).type
		const id = blockIdOf(child)
		if (typeof type === 'string' && ANCHOR_BLOCK_TYPES.has(type) && id && !(id in blocks))
			blocks[id] = { type, text: blockTextOf(child) }
	}
	return blocks
}

/** 浏览器交来的锚点：块 id、引用（1–200 字）、前后文（各 50 字内，用来在重复的引用里挑） */
export function parseAnchorInput(value: unknown): CommentAnchorDraft | undefined | null {
	if (value === undefined)
		return undefined
	const input = objectField(value)
	const { blockId, quote, prefix, suffix } = input
	// 评论整段：只要块 id
	if (input.mode === 'block')
		return typeof blockId === 'string' && BLOCK_ID.test(blockId) ? { blockId, mode: 'block', quote: '', prefix: '', suffix: '' } : null
	if (typeof blockId !== 'string' || !BLOCK_ID.test(blockId) || typeof quote !== 'string' || !quote.trim() || quote.length > QUOTE_MAX)
		return null
	const context = (text: unknown) => (typeof text === 'string' ? text.slice(-CONTEXT_MAX) : '')
	return { blockId, quote, prefix: context(prefix), suffix: typeof suffix === 'string' ? suffix.slice(0, CONTEXT_MAX) : '' }
}

function commonSuffixLength(a: string, b: string) {
	let n = 0
	while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n])
		n++
	return n
}

function commonPrefixLength(a: string, b: string) {
	let n = 0
	while (n < a.length && n < b.length && a[n] === b[n])
		n++
	return n
}

/** 引用在块文字里的每一处起点 */
function occurrencesOf(text: string, quote: string) {
	const starts: number[] = []
	for (let at = text.indexOf(quote); at >= 0 && starts.length < 100; at = text.indexOf(quote, at + 1))
		starts.push(at)
	return starts
}

/** 重复出现时按前后文挑最像的那一处；返回它在所有出现里的序号 */
export function pickOccurrence(text: string, quote: string, prefix = '', suffix = '') {
	const starts = occurrencesOf(text, quote)
	if (!starts.length)
		return undefined
	let best = 0
	let bestScore = -1
	starts.forEach((start, index) => {
		const score = commonSuffixLength(text.slice(0, start), prefix) + commonPrefixLength(text.slice(start + quote.length), suffix)
		if (score > bestScore) {
			best = index
			bestScore = score
		}
	})
	return { index: best, start: starts[best]! }
}

/** core 的 range 锚点（字段照 `RangeCommentAnchorSchema`） */
export interface CoreRangeAnchor {
	mode: 'range'
	blockId: string
	blockType: string
	quote: string
	prefix: string
	suffix: string
	startOffset: number
	endOffset: number
	snapshotText: string
}

/** core 的 block 锚点（评论整段，字段照 `BlockCommentAnchorSchema`） */
export interface CoreBlockAnchor {
	mode: 'block'
	blockId: string
	blockType: string
	snapshotText: string
}

/** 按正文重建锚点；块不存在、引用不在块里时返回 undefined */
export function buildAnchor(blocks: Record<string, AnchorBlock>, input: CommentAnchorDraft): CoreRangeAnchor | CoreBlockAnchor | undefined {
	const block = blocks[input.blockId]
	if (!block)
		return undefined
	if (input.mode === 'block')
		return { mode: 'block', blockId: input.blockId, blockType: block.type, snapshotText: block.text.slice(0, SNAPSHOT_MAX) }
	const found = pickOccurrence(block.text, input.quote, input.prefix, input.suffix)
	if (!found)
		return undefined
	const end = found.start + input.quote.length
	return {
		mode: 'range',
		blockId: input.blockId,
		blockType: block.type,
		quote: input.quote,
		prefix: block.text.slice(Math.max(0, found.start - CONTEXT_MAX), found.start),
		suffix: block.text.slice(end, end + CONTEXT_MAX),
		startOffset: found.start,
		endOffset: end,
		snapshotText: block.text.slice(0, SNAPSHOT_MAX),
	}
}

/**
 * core 存的锚点 → 评论上显示的：引用在当前正文（匿名取的）里还找得到才给块 id 与引用，找不到只说「已不在原文中」
 * （不再显示引用本身：那段可能后来改成了付费内容）。不是 range 锚点、没有正文可比时不显示。
 */
export function commentAnchorOf(raw: unknown, blocks: Record<string, AnchorBlock> | undefined): CommentAnchor | undefined {
	const anchor = objectField(raw)
	if (blocks && anchor.mode === 'block' && typeof anchor.blockId === 'string') {
		const block = blocks[anchor.blockId]
		if (!block)
			return { stale: true, mode: 'block' }
		const text = block.text.replace(/\s+/g, ' ').trim()
		return { blockId: anchor.blockId, block: text.length > 40 ? `${text.slice(0, 40)}…` : text }
	}
	if (!blocks || anchor.mode !== 'range' || typeof anchor.blockId !== 'string' || typeof anchor.quote !== 'string' || !anchor.quote)
		return undefined
	const block = blocks[anchor.blockId]
	if (!block || anchor.quote.length > QUOTE_MAX || !block.text.includes(anchor.quote))
		return { stale: true }
	return { blockId: anchor.blockId, quote: anchor.quote }
}

/** 正文高亮的一条：在哪一块、引用、是第几处出现（按 core 存的前后文挑） */
export interface AnchorHighlight {
	id: string
	blockId: string
	/** 段落评论：没有引用与序号 */
	mode?: 'block'
	quote: string
	index: number
}

export function anchorHighlightOf(id: string, raw: unknown, blocks: Record<string, AnchorBlock>): AnchorHighlight | undefined {
	const shown = commentAnchorOf(raw, blocks)
	if (!shown || 'stale' in shown)
		return undefined
	if ('block' in shown)
		return { id, blockId: shown.blockId, mode: 'block', quote: '', index: 0 }
	const anchor = objectField(raw)
	const found = pickOccurrence(blocks[shown.blockId]!.text, shown.quote, typeof anchor.prefix === 'string' ? anchor.prefix : '', typeof anchor.suffix === 'string' ? anchor.suffix : '')
	return found && { id, blockId: shown.blockId, quote: shown.quote, index: found.index }
}
