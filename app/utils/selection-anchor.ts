import type { CommentAnchorDraft } from '~/types/comment'

/**
 * 划词评论在浏览器里的部分：块的文字、选区 → 锚点、引用 → Range。只在浏览器里用。
 *
 * 块文字照服务端（core 的 `extractBlockText`）的算法：文本节点原样、`<br>` 是 `\n`；
 * 公式的 MathML 副本、读屏隐藏的内容不算。前后文各取 50 字，只用来在重复的引用里挑
 */
const QUOTE_MAX = 200
const CONTEXT_MAX = 50

interface Point {
	node: Node
	offset: number
}

interface BlockText {
	text: string
	/** 每个字的起点与终点 */
	starts: Point[]
	ends: Point[]
}

function skipped(node: Node) {
	const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
	return Boolean(element?.closest('.katex-mathml, [aria-hidden="true"], script, style'))
}

export function blockTextOf(block: Element): BlockText {
	const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
		acceptNode: node => skipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	})
	const result: BlockText = { text: '', starts: [], ends: [] }
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.nodeType === Node.TEXT_NODE) {
			const value = (node as Text).data
			for (let i = 0; i < value.length; i++) {
				result.text += value[i]
				result.starts.push({ node, offset: i })
				result.ends.push({ node, offset: i + 1 })
			}
		}
		else if ((node as Element).tagName === 'BR' && node.parentNode) {
			const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node)
			result.text += '\n'
			result.starts.push({ node: node.parentNode, offset: index })
			result.ends.push({ node: node.parentNode, offset: index + 1 })
		}
	}
	return result
}

/** 选区所在的可评论块：起止都在同一个 `[data-block-id]` 里，而且在正文（`root`）里 */
export function anchorBlockOf(range: Range, root: Element) {
	const blockOf = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('[data-block-id]')
	const start = blockOf(range.startContainer)
	return start && start === blockOf(range.endContainer) && root.contains(start) ? start : undefined
}

/** 选区 → 锚点草稿；去掉首尾空白后为空或超过 200 字时返回 undefined */
export function anchorFromRange(block: Element, range: Range): CommentAnchorDraft | undefined {
	const blockId = block.getAttribute('data-block-id')
	if (!blockId)
		return undefined
	const { text, starts, ends } = blockTextOf(block)
	let first = -1
	let last = -1
	for (let i = 0; i < text.length; i++) {
		if (range.comparePoint(starts[i]!.node, starts[i]!.offset) === 0 && range.comparePoint(ends[i]!.node, ends[i]!.offset) === 0) {
			if (first < 0)
				first = i
			last = i
		}
	}
	if (first < 0)
		return undefined
	let start = first
	let end = last + 1
	while (start < end && /\s/.test(text[start]!))
		start++
	while (end > start && /\s/.test(text[end - 1]!))
		end--
	const quote = text.slice(start, end)
	if (!quote || quote.length > QUOTE_MAX)
		return undefined
	return { blockId, quote, prefix: text.slice(Math.max(0, start - CONTEXT_MAX), start), suffix: text.slice(end, end + CONTEXT_MAX) }
}

/** 块里引用的第 `index` 处（找不到那么多处时用第一处）→ Range；找不到返回 undefined */
export function quoteRangeIn(block: Element, quote: string, index = 0): Range | undefined {
	const { text, starts, ends } = blockTextOf(block)
	const found: number[] = []
	for (let at = text.indexOf(quote); at >= 0 && found.length <= index; at = text.indexOf(quote, at + 1))
		found.push(at)
	const start = found[index] ?? found[0]
	if (start === undefined || !quote)
		return undefined
	const range = document.createRange()
	range.setStart(starts[start]!.node, starts[start]!.offset)
	const end = ends[start + quote.length - 1]!
	range.setEnd(end.node, end.offset)
	return range
}

/** 正文里某一块（按块 id 找） */
export function anchorBlockById(root: ParentNode, blockId: string) {
	return root.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`) ?? undefined
}
