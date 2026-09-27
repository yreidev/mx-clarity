import type { VNode } from 'vue'

/**
 * 正文标题的锚点链接（覆盖 @nuxtjs/mdc 的 ProseH2–H4）。mdc 默认把标题内容整个包进 `<a href="#id">`，
 * 标题里本身有链接时就成了 `<a>` 套 `<a>`：HTML 不允许，服务端输出的结构会被浏览器拆开，水合对不上
 * （形如「## [链接文字](…)」的标题实测）。标题里已有链接时不再包锚点
 */
export function containsLink(nodes: unknown): boolean {
	if (!Array.isArray(nodes))
		return false
	return nodes.some((node) => {
		const vnode = node as VNode
		if (!vnode || typeof vnode !== 'object')
			return false
		if (vnode.type === 'a' || (vnode.props && 'href' in vnode.props))
			return true
		return containsLink(vnode.children)
	})
}

export function useHeadingAnchor(level: 'h2' | 'h3' | 'h4') {
	const { headings } = useRuntimeConfig().public.mdc as { headings?: { anchorLinks?: boolean | Record<string, boolean> } }
	const enabled = headings?.anchorLinks === true || (typeof headings?.anchorLinks === 'object' && headings.anchorLinks[level] === true)
	/** 在模板里调用（插槽要在渲染时取） */
	return (id: string | undefined, slot: VNode[] | undefined) => Boolean(id && enabled && !containsLink(slot))
}
