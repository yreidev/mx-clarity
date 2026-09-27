/**
 * 路径 A：mx 的 Lexical JSON（`post.content`）→ mdc AST（「路径 A 的实现方式」）。
 *
 * 输出交给与路径 B 相同的渲染器，节点直接指向 blog-v3 的内容组件（Alert、Folding、Pic…），
 * 形状照着 mdc 的产物做，两条路径因此共用同一套组件、同一套标题 id 与目录规则。
 *
 * 节点字段以 `@haklex/rich-headless@0.42.1` 各节点的 exportJSON 为准。
 */
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import type { UiLang } from '~~/shared/utils/i18n'
import type { RenderedBody } from './body'
import { generateToc } from '@nuxtjs/mdc/runtime/parser/toc'
import Slugger from 'github-slugger'
import { translate } from '~~/shared/utils/i18n'
import { ANCHOR_BLOCK_TYPES, blockIdOf } from './anchor'
import { isSafeUrl, MENTION_PLATFORMS, mentionLabelOf, renderMarkdownBody, sanitizeBody } from './body'
import { embedTargetOf, excalidrawSummaryOf, fileCardPropsOf, galleryPropsOf, imageMetaOf, mapPropsOf, pollPropsOf, staticPollOf, stockPropsOf } from './rich-blocks'

interface LexicalNode {
	type?: string
	children?: LexicalNode[]
	[key: string]: unknown
}

interface EditorState {
	root?: LexicalNode
}

type Props = Record<string, unknown>

const el = (tag: string, props: Props = {}, children: MDCNode[] = []): MDCElement => ({ type: 'element', tag, props, children })
const txt = (value: string): MDCNode => ({ type: 'text', value })
const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** 不支持显示的节点给占位段落，绝不输出原始 JSON；`what` 是已按界面语言取好的名字 */
const placeholder = (ui: UiLang, what?: string) => [el('p', { className: ['mx-unsupported'] }, [el('em', {}, [txt(what ? translate(ui, 'content.cantShownHere', { what }) : translate(ui, 'content.contentCantShown'))])])]

/** 渲染后是块级元素的标签：出现在段落里时要把段落拆开，否则 <p> 里套块级元素会让 SSR 水合失败 */
const BLOCK_TAGS = new Set([
	'alert',
	'blockquote',
	'card-list',
	'chat',
	'div',
	'figure',
	'file-card',
	'folding',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'link-card',
	'map-block',
	'mermaid',
	'mx-gallery',
	'mx-poll',
	'ol',
	'p',
	'pic',
	'pre',
	'section',
	'stock-block',
	'table',
	'ul',
	'video-embed',
])

const isBlock = (node: MDCNode) => node.type === 'element' && BLOCK_TAGS.has((node as MDCElement).tag)

function safeHref(url: unknown) {
	const value = str(url).trim()
	return value && isSafeUrl(value) ? value : undefined
}

function textOf(node: LexicalNode | undefined): string {
	if (!node)
		return ''
	if (typeof node.text === 'string')
		return node.text
	if (node.type === 'linebreak')
		return '\n'
	if (node.type === 'tab')
		return '\t'
	return (node.children ?? []).map(textOf).join('')
}

// ———————————————————————————— 行内 ————————————————————————————

// Lexical 的文本格式位（lexical 的 IS_BOLD 等常量）：内层在前，外层在后
const TEXT_FORMATS: Array<[number, string]> = [
	[64, 'sup'],
	[32, 'sub'],
	[128, 'mark'],
	[8, 'u'],
	[4, 'del'],
	[2, 'em'],
	[1, 'strong'],
]

function textNode(node: LexicalNode): MDCNode {
	const value = str(node.text)
	const format = Number(node.format) || 0
	// 行内代码与 mdc（打过补丁，props.code 传原文）同形
	let out: MDCNode = format & 16 ? el('code', { className: [], code: value }, [txt(value)]) : txt(value)
	for (const [bit, tag] of TEXT_FORMATS) {
		if (format & bit)
			out = el(tag, {}, [out])
	}
	return out
}

function linkNode(href: string | undefined, children: MDCNode[], target?: unknown) {
	if (!href)
		return children
	const props: Props = { href }
	if (/^https?:/i.test(href))
		props.rel = target === '_blank' ? ['noopener', 'noreferrer', 'nofollow'] : ['nofollow']
	if (target === '_blank')
		props.target = '_blank'
	return [el('a', props, children)]
}

function mentionNode(node: LexicalNode, ui: UiLang) {
	const handle = str(node.handle)
	const label = str(node.displayName) || `@${handle}`
	const platform = str(node.platform).toUpperCase()
	const host = MENTION_PLATFORMS[platform]?.host
	if (!host || !/^[\w.-]+$/.test(handle))
		return [txt(label)]
	const links = linkNode(`${host}${handle}`, [txt(label)])
	for (const link of links) {
		if (link.type === 'element')
			(link as MDCElement).props = { ...(link as MDCElement).props, 'aria-label': mentionLabelOf(platform, handle, str(node.displayName) || undefined, ui) }
	}
	return links
}

const footnoteId = (id: unknown) => str(id).replace(/[^\w-]/g, '_')

// ———————————————————————————— 转换 ————————————————————————————

interface Context {
	katex: (tex: string, display: boolean) => Promise<MDCNode[]>
	/** 占位、提及的可访问名称这类主题生成的文字用的界面语言 */
	ui: UiLang
}

async function convertAll(nodes: LexicalNode[] | undefined, ctx: Context) {
	const out: MDCNode[] = []
	for (const node of nodes ?? [])
		out.push(...await convert(node, ctx))
	return out
}

/** 嵌套编辑器状态（alert-quote / banner / nested-doc 的 content、grid 的 cell） */
const convertState = (state: unknown, ctx: Context) => convertAll((state as EditorState | undefined)?.root?.children, ctx)

/** 把含块级输出的行内序列切成「段落 / 块 / 段落」 */
function paragraphs(inline: MDCNode[], props: Props = {}) {
	const out: MDCNode[] = []
	let run: MDCNode[] = []
	const flush = () => {
		// mdc 会删掉只含空白的段落
		if (run.some(n => n.type !== 'text' || /\S/.test((n as { value?: string }).value ?? '')))
			out.push(el('p', props, run))
		run = []
	}
	for (const node of inline) {
		if (isBlock(node)) {
			flush()
			out.push(node)
		}
		else {
			run.push(node)
		}
	}
	flush()
	return out
}

/** 表格单元格、列表项里的段落照 mdc 展开：内联内容直接放进去，段落之间插 <br> */
function unwrapParagraphs(nodes: MDCNode[]) {
	const out: MDCNode[] = []
	let seenParagraph = false
	for (const node of nodes) {
		if (node.type === 'element' && (node as MDCElement).tag === 'p') {
			if (seenParagraph)
				out.push(el('br'))
			seenParagraph = true
			out.push(...((node as MDCElement).children ?? []))
		}
		else {
			out.push(node)
		}
	}
	return out
}

const ALERT_TYPES: Record<string, string> = {
	note: 'info',
	tip: 'tip',
	important: 'question',
	warning: 'warning',
	caution: 'error',
}

const BANNER_TYPES: Record<string, string> = {
	note: 'info',
	info: 'info',
	secondary: 'info',
	tip: 'tip',
	success: 'tip',
	warning: 'warning',
	error: 'error',
	danger: 'error',
}

function codeBlock(code: string, language: string, filename?: string): MDCElement {
	// 与 mdc 的产物同形：代码末尾带换行
	const value = code.endsWith('\n') ? code : `${code}\n`
	const props: Props = { className: language ? [`language-${language}`] : [], code: value, meta: '' }
	if (language)
		props.language = language
	if (filename)
		props.filename = filename
	return el('pre', props, [el('code', { __ignoreMap: '' }, [txt(value)])])
}

function imageNode(node: LexicalNode | Record<string, unknown>) {
	const src = safeHref(node.src)
	if (!src)
		return []
	// 宽高（占住比例）、主色（底色）、thumbhash（模糊占位）都是编辑器写的，照样校验
	const props: Props = { src, alt: str(node.altText ?? node.alt), ...imageMetaOf(node) }
	if (str(node.caption))
		props.caption = str(node.caption)
	return [el('pic', props)]
}

function tableNode(node: LexicalNode, cellsOf: (row: LexicalNode) => Promise<MDCElement[]>) {
	return (async () => {
		const rows = (node.children ?? []).filter(row => row.type === 'tablerow')
		const [first, ...rest] = rows
		const isHeaderRow = first?.children?.length && first.children.every(cell => (Number(cell.headerState) & 1) === 1)
		const bodyRows = isHeaderRow ? rest : rows
		const out: MDCElement[] = []
		if (isHeaderRow)
			out.push(el('thead', {}, [el('tr', {}, await cellsOf(first!))]))
		const trs: MDCElement[] = []
		for (const row of bodyRows)
			trs.push(el('tr', {}, await cellsOf(row)))
		if (trs.length)
			out.push(el('tbody', {}, trs))
		return [el('table', {}, out)]
	})()
}

async function convert(node: LexicalNode, ctx: Context): Promise<MDCNode[]> {
	switch (node.type) {
		// —— 行内 ——
		case 'text':
			return [textNode(node)]
		case 'linebreak':
			return [el('br')]
		case 'tab':
			return [txt('\t')]
		case 'link':
		case 'autolink':
			return linkNode(safeHref(node.url), await convertAll(node.children, ctx), node.target)
		case 'mention':
			return mentionNode(node, ctx.ui)
		case 'spoiler':
			return [el('blur', {}, await convertAll(node.children, ctx))]
		case 'ruby':
			return [el('ruby', {}, [...await convertAll(node.children, ctx), el('rt', {}, [txt(str(node.reading))])])]
		case 'katex-inline':
			return ctx.katex(str(node.equation), false)
		case 'footnote': {
			const id = footnoteId(node.identifier)
			return [el('sup', { id: `fnref-${id}` }, [el('a', { href: `#fn-${id}` }, [txt(`[${str(node.identifier)}]`)])])]
		}
		case 'tag':
			return [el('span', { className: ['mx-tag'] }, [txt(`#${str(node.text)}`)])]
		// 批注不显示；路径 B 里它投影成 HTML 注释，同样被删掉
		case 'comment':
			return []

		// —— 块 ——
		case 'root':
			return convertAll(node.children, ctx)
		case 'paragraph': {
			const align = str(node.format)
			const props = ['center', 'right', 'justify'].includes(align) ? { style: `text-align:${align}` } : {}
			return paragraphs(await convertAll(node.children, ctx), props)
		}
		case 'heading': {
			// 正文里的一级标题降为二级：页面标题已经是 h1
			const level = Math.min(6, Math.max(2, Number(str(node.tag).slice(1)) || 2))
			return [el(`h${level}`, {}, await convertAll(node.children, ctx))]
		}
		case 'quote':
			return [el('blockquote', {}, paragraphs(await convertAll(node.children, ctx)))]
		case 'rich-quote': {
			const children = await convertAll(node.children, ctx)
			const body = children.some(isBlock) ? children : paragraphs(children)
			if (str(node.attribution))
				body.push(el('p', { className: ['quote-attribution'] }, [txt(`— ${str(node.attribution)}`)]))
			return [el('blockquote', {}, body)]
		}
		case 'list': {
			const listType = str(node.listType)
			const props: Props = listType === 'check' ? { className: ['contains-task-list'] } : {}
			const start = Number(node.start)
			if (listType === 'number' && start && start !== 1)
				props.start = start
			const items: MDCNode[] = []
			for (const item of node.children ?? []) {
				const children = unwrapParagraphs(await convertAll(item.children, ctx))
				if (listType === 'check') {
					const box = el('input', { type: 'checkbox', disabled: true, checked: Boolean(item.checked) })
					items.push(el('li', { className: ['task-list-item'] }, [box, txt(' '), ...children]))
				}
				else {
					items.push(el('li', {}, children))
				}
			}
			return [el(listType === 'number' ? 'ol' : 'ul', props, items)]
		}
		case 'horizontalrule':
			return [el('hr')]
		// 没标语言的按 text：mdc 解析不带语言的围栏时给的就是 language=text（实测），两条路径才对得上
		case 'code-block':
			return [codeBlock(str(node.code), str(node.language) || 'text')]
		// Lexical 自带的代码节点（子节点是 code-highlight 等），旧文档里可能出现
		case 'code':
			return [codeBlock(textOf(node), str(node.language) || 'text')]
		case 'katex-block':
			return ctx.katex(str(node.equation), true)
		case 'mermaid':
			return [el('mermaid', { code: str(node.diagram) })]
		case 'image':
			return imageNode(node)
		case 'gallery': {
			const images = (Array.isArray(node.images) ? node.images : []).flatMap(image => typeof image === 'object' && image !== null ? imageNode(image as Record<string, unknown>) : [])
			return images.length ? [el('mx-gallery', galleryPropsOf(node), images)] : []
		}
		case 'video': {
			const src = safeHref(node.src)
			if (!src)
				return []
			const props: Props = { type: 'raw', id: src }
			if (safeHref(node.poster))
				props.poster = safeHref(node.poster)
			return [el('video-embed', props)]
		}
		case 'embed': {
			const target = embedTargetOf(node.url)
			if (!target)
				return []
			return target.kind === 'video'
				? [el('video-embed', { type: target.type, id: target.id })]
				: [el('link-card', { link: target.link, title: target.title })]
		}
		case 'link-card': {
			const link = safeHref(node.url)
			if (!link)
				return []
			const props: Props = { link, title: str(node.title) || link }
			if (str(node.description))
				props.description = str(node.description)
			if (safeHref(node.favicon))
				props.icon = safeHref(node.favicon)
			return [el('link-card', props)]
		}
		case 'alert-quote':
			return [el('alert', { type: ALERT_TYPES[str(node.alertType)] ?? 'info' }, await convertState(node.content, ctx))]
		case 'banner':
			return [el('alert', { type: BANNER_TYPES[str(node.bannerType)] ?? 'info' }, await convertState(node.content, ctx))]
		case 'details':
			return [el('folding', { title: str(node.summary) }, await convertAll(node.children, ctx))]
		case 'grid-container': {
			const cells: MDCNode[] = []
			for (const cell of Array.isArray(node.cells) ? node.cells : [])
				cells.push(el('li', {}, await convertState(cell, ctx)))
			return [el('card-list', {}, [el('ul', {}, cells)])]
		}
		case 'nested-doc':
			return [el('div', { className: ['mx-nested-doc'] }, await convertState(node.content, ctx))]
		case 'table':
			return tableNode(node, async row => Promise.all((row.children ?? []).map(async (cell) => {
				const header = (Number(cell.headerState) & 1) === 1
				const props: Props = {}
				if (Number(cell.colSpan) > 1)
					props.colspan = Number(cell.colSpan)
				if (Number(cell.rowSpan) > 1)
					props.rowspan = Number(cell.rowSpan)
				return el(header ? 'th' : 'td', props, unwrapParagraphs(await convertAll(cell.children, ctx)))
			})))
		case 'chat':
			return [chatNode(node)]
		case 'footnote-section': {
			const definitions = (node.definitions ?? {}) as Record<string, unknown>
			const items = Object.entries(definitions).map(([key, value]) => {
				const id = footnoteId(key)
				const content = typeof value === 'string' ? value : textOf(value as LexicalNode)
				return el('li', { id: `fn-${id}` }, [txt(`${content} `), el('a', { href: `#fnref-${id}` }, [txt('↩')])])
			})
			return items.length ? [el('section', { className: ['footnotes'] }, [el('ol', {}, items)])] : []
		}
		case 'code-snippet':
			return (Array.isArray(node.files) ? node.files : []).map((file) => {
				const f = file as Record<string, unknown>
				return codeBlock(str(f.code ?? f.content), str(f.language), str(f.filename ?? f.name) || undefined)
			})
		case 'poll': {
			const props = pollPropsOf(node, ctx.ui)
			if (props)
				return [el('mx-poll', props)]
			const labels = (Array.isArray(node.options) ? node.options : []).map(o => str((o as Record<string, unknown>).label))
			return [staticPollOf(str(node.question), labels, translate(ctx.ui, 'content.pollMalformedCant'))]
		}
		case 'file': {
			const props = fileCardPropsOf(node, ctx.ui)
			if (!props)
				return []
			// 行内显示的就是一个链接，放进段落
			return props.inline
				? [el('p', {}, linkNode(String(props.src), [txt(String(props.name))]))]
				: [el('file-card', props)]
		}
		case 'excalidraw': {
			const summary = excalidrawSummaryOf(node.snapshot)
			if (!summary)
				return placeholder(ctx.ui, translate(ctx.ui, 'content.excalidrawDrawing'))
			return [el('div', { className: ['mx-unsupported', 'mx-excalidraw'] }, [
				el('p', {}, [el('em', {}, [txt(summary.texts.length
					? translate(ctx.ui, 'content.excalidrawDrawingElementsCant', { n: summary.count })
					: translate(ctx.ui, 'content.excalidrawDrawingElements', { n: summary.count }))])]),
				...summary.texts.length ? [el('ul', {}, summary.texts.map(text => el('li', {}, [txt(text)])))] : [],
			])]
		}
		case 'dynamic':
			// 远程组件：永远不加载它的脚本，也不把地址显示成链接
			return placeholder(ctx.ui, translate(ctx.ui, 'content.dynamicComponent'))
		case 'stock': {
			const props = stockPropsOf(node)
			return props ? [el('stock-block', props)] : placeholder(ctx.ui, translate(ctx.ui, 'content.stockQuote'))
		}
		case 'map': {
			const props = mapPropsOf(node)
			if (props)
				return [el('map-block', props)]
			return placeholder(ctx.ui, str(node.title) ? translate(ctx.ui, 'content.map2', { title: str(node.title).slice(0, 40) }) : translate(ctx.ui, 'content.map'))
		}
		case 'afilmory': {
			const title = str(node.title).slice(0, 80) || translate(ctx.ui, 'content.album2')
			const link = safeHref(node.baseUrl)
			return [el('div', { className: ['mx-unsupported'] }, [
				el('p', {}, [el('em', {}, [txt(translate(ctx.ui, 'content.albumsCantShown', { title }))])]),
				...str(node.caption) ? [el('p', {}, [txt(str(node.caption).slice(0, 200))])] : [],
				...link && /^https?:\/\//i.test(link) ? [el('p', {}, linkNode(link, [txt(translate(ctx.ui, 'content.viewAlbum'))], '_blank'))] : [],
			])]
		}
		default:
			return placeholder(ctx.ui)
	}
}

/** `Chat.vue` 的约定：`{名字}` 起一段对方的发言，`{.名字}` 是自己的 */
function chatNode(node: LexicalNode): MDCElement {
	const participants = new Map<string, Record<string, unknown>>()
	for (const p of Array.isArray(node.participants) ? node.participants : [])
		participants.set(str((p as Record<string, unknown>).id), p as Record<string, unknown>)
	const children: MDCNode[] = []
	for (const message of Array.isArray(node.messages) ? node.messages : []) {
		const m = message as Record<string, unknown>
		const who = participants.get(str(m.participantId))
		const self = node.variant === 'user-agent' && who?.kind === 'user'
		const content = typeof m.content === 'string' ? m.content : textOf(m.content as LexicalNode)
		children.push(el('p', {}, [txt(`{${self ? '.' : ''}${str(who?.name) || '?'}}`)]), el('p', {}, [txt(content)]))
	}
	return el('chat', {}, children)
}

/** 标题 id 与 mdc 完全同规则（`compiler.js:41`），两条路径的锚点与目录因此一致 */
function assignHeadingIds(body: MDCRoot) {
	const slugs = new Slugger()
	const text = (node: MDCNode): string => node.type === 'text'
		? ((node as { value?: string }).value ?? '')
		: ((node as MDCElement).children ?? []).map(text).join('')
	const walk = (nodes: MDCNode[] = []) => {
		for (const node of nodes) {
			if (node.type !== 'element')
				continue
			const element = node as MDCElement
			if (/^h\d$/.test(element.tag)) {
				element.props ??= {}
				element.props.id = String(slugs.slug(text(element))).replace(/-+/g, '-').replace(/^-|-$/g, '').replace(/^(\d)/, '_$1')
			}
			walk(element.children)
		}
	}
	walk(body.children)
}

/** 公式直接交给路径 B 的解析器，保证两条路径的 KaTeX 输出逐字一致 */
async function katex(tex: string, display: boolean): Promise<MDCNode[]> {
	if (!tex.trim())
		return []
	const { body } = await renderMarkdownBody(display ? `$$\n${tex}\n$$` : `$${tex}$`)
	const nodes = body.children ?? []
	if (!display && nodes.length === 1 && nodes[0]!.type === 'element' && (nodes[0] as MDCElement).tag === 'p')
		return (nodes[0] as MDCElement).children ?? []
	return nodes
}

/** 解析失败（JSON 坏了、没有 root）返回 undefined，调用方退到路径 B */
export function parseLexicalState(content: string | undefined | null): EditorState | undefined {
	if (!content)
		return undefined
	try {
		const state = JSON.parse(content) as EditorState
		return state?.root && Array.isArray(state.root.children) ? state : undefined
	}
	catch {
		return undefined
	}
}

/**
 * 根节点逐个转换。段落、标题、引用、列表转出来正好是一个元素时，给它加上 core 的块 id（`data-block-id`），
 * 划词评论按它找块；转出多个元素（段落里夹着块级内容被拆开）的不加，那一块不能划词评论
 */
async function convertRoot(nodes: LexicalNode[] | undefined, ctx: Context) {
	const out: MDCNode[] = []
	// 重复的块 id 只认第一个（与服务端核对锚点时一致）
	const seen = new Set<string>()
	for (const node of nodes ?? []) {
		const converted = await convert(node, ctx)
		const id = node.type && ANCHOR_BLOCK_TYPES.has(node.type) ? blockIdOf(node) : undefined
		const [only] = converted
		if (id && !seen.has(id) && converted.length === 1 && only?.type === 'element')
			only.props = { ...only.props, 'data-block-id': id }
		if (id)
			seen.add(id)
		out.push(...converted)
	}
	return out
}

export async function renderLexicalBody(state: EditorState, ui: UiLang = 'zh'): Promise<RenderedBody> {
	const body: MDCRoot = { type: 'root', children: await convertRoot(state.root?.children, { katex, ui }) }
	sanitizeBody(body)
	assignHeadingIds(body)
	return { body, toc: generateToc(body, { title: '', depth: 4, searchDepth: 4, links: [] }) }
}
