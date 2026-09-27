/**
 * 在正文里找一段文字（AI 洞察的「跳回原文」、划词评论的引用）：先原样找；找不到时两边都去掉空白与 markdown 记号再找
 * （洞察的引用取自 markdown 投影，可能带着 `**`、`[]()`）。只在浏览器里用
 */
const MARKS = /[\s*_~`#>[\]()]/u

interface Mapped {
	text: string
	/** 规整后每个字符对应的文本节点与偏移 */
	positions: { node: Text, offset: number }[]
}

function collect(root: Element, strip: boolean): Mapped {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		// 公式的 MathML 副本、读屏隐藏的内容不算
		acceptNode: node => node.parentElement?.closest('.katex-mathml, [aria-hidden="true"], script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	})
	let text = ''
	const positions: Mapped['positions'] = []
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const value = node.data
		for (let i = 0; i < value.length; i++) {
			if (strip && MARKS.test(value[i]!))
				continue
			text += value[i]
			positions.push({ node, offset: i })
		}
	}
	return { text: text.normalize('NFC'), positions }
}

export function locateQuote(root: Element, quote: string): Range | undefined {
	for (const strip of [false, true]) {
		const target = (strip ? [...quote].filter(char => !MARKS.test(char)).join('') : quote).normalize('NFC')
		if (!target)
			continue
		const mapped = collect(root, strip)
		const at = mapped.text.indexOf(target)
		if (at < 0)
			continue
		const start = mapped.positions[at]
		const end = mapped.positions[at + target.length - 1]
		if (!start || !end)
			continue
		const range = document.createRange()
		range.setStart(start.node, start.offset)
		range.setEnd(end.node, end.offset + 1)
		return range
	}
	return undefined
}

/** 滚到这段文字并闪一下（CSS Custom Highlight API，不改 DOM；浏览器不支持就只滚动） */
export function flashRange(range: Range, name = 'mx-quote') {
	range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
	const registry = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
	const HighlightClass = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
	if (!registry || !HighlightClass)
		return
	registry.set(name, new HighlightClass(range))
	setTimeout(() => registry.delete(name), 2400)
}
