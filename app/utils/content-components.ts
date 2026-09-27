/**
 * 正文里的标签 → components/content 下的内容组件，给 `MxRenderer` 用。
 * 与 Nuxt Content 的 ContentRenderer 同一做法：按文件名懒加载，只加载正文里实际出现的。
 */
import type { MDCNode, MDCRoot } from '@nuxtjs/mdc'
import type { DefineComponent } from 'vue'
import htmlTags from '@nuxtjs/mdc/runtime/parser/utils/html-tags-list'
import { pascalCase } from 'es-toolkit/string'

/** MDCRenderer 的 `components` 只收这个类型 */

type ContentComponent = DefineComponent<any, any, any>

const loaders = import.meta.glob<ContentComponent>('../components/content/*.vue', { import: 'default' })
const LOCAL = new Map(Object.entries(loaders).map(([path, load]) => [path.slice(path.lastIndexOf('/') + 1, -'.vue'.length), load]))

/** 与 MDCRenderer 的 prose 映射相同：这些 HTML 标签渲染成 `Prose*` 组件 */
const PROSE_TAGS = new Set(['p', 'a', 'blockquote', 'code', 'pre', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'ul', 'ol', 'li', 'strong', 'table', 'thead', 'tbody', 'td', 'th', 'tr', 'script'])

/** 全站共用，同一个组件只包一次 */
const asyncComponents = new Map<string, ContentComponent>()

function localComponent(name: string) {
	const load = LOCAL.get(name)
	if (!load)
		return undefined
	let component = asyncComponents.get(name)
	if (!component) {
		component = defineAsyncComponent(load)
		asyncComponents.set(name, component)
	}
	return component
}

function collect(node: MDCNode | MDCRoot, out: Record<string, ContentComponent>) {
	if (node.type === 'text' || node.type === 'comment')
		return
	if (node.type === 'element' && !(node.tag in out)) {
		const prose = PROSE_TAGS.has(node.tag)
		const component = prose || !htmlTags.has(node.tag)
			? localComponent(pascalCase(prose ? `prose-${node.tag}` : node.tag))
			: undefined
		if (component)
			out[node.tag] = component
	}
	for (const child of node.children ?? [])
		collect(child, out)
}

/**
 * blog-v3 自带的 `ProseA` 等优先（`ProseH2`–`H4` 也有本地版本，见 useHeadingAnchor）；没有本地版本的 prose 标签交给 mdc 自己的全局组件，
 * 普通 HTML 标签原样输出
 */
export function contentComponentsFor(body: MDCRoot) {
	const out: Record<string, ContentComponent> = {}
	collect(body, out)
	return out
}
