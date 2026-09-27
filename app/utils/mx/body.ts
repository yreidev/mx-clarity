/**
 * 路径 B：把 mx 的 markdown 投影（`post.text`）变成可渲染的 MDC AST 与目录。
 *
 * 只在服务端调用：mdc 运行时会合并模块注册的插件，其中有浏览器加载不了的本地 `.ts` 插件。
 */
import type { MDCElement, MDCNode, MDCRoot, Toc } from '@nuxtjs/mdc'
import type { UiLang } from '~~/shared/utils/i18n'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import htmlTags from '@nuxtjs/mdc/runtime/parser/utils/html-tags-list'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { translate } from '~~/shared/utils/i18n'
import { mediaUrlOf, videoSrcOf } from '~~/shared/utils/video'
import { liteXmlBlockOf } from './rich-blocks'

export interface RenderedBody {
	body: MDCRoot
	toc?: Toc
}

const FENCE_OPEN = /^\s{0,3}(`{3,}|~{3,})/

/** 逐行改写，跳过代码围栏内部（围栏按 CommonMark：同字符、不短于开头的一行才闭合） */
function mapOutsideFences(text: string, transform: (line: string) => string) {
	let fence: { char: string, length: number } | undefined
	return text.split('\n').map((line) => {
		const marker = line.match(FENCE_OPEN)?.[1]
		if (fence) {
			if (marker && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker)
				fence = undefined
			return line
		}
		if (marker) {
			fence = { char: marker[0]!, length: marker.length }
			return line
		}
		return transform(line)
	}).join('\n')
}

/**
 * 解析前的文本预处理：
 * - mx 输出 `::: details{…}`（冒号后带空格），mdc 只认 `:::details{…}`（实测）
 * - 正文里的一级标题降为二级，目录随之按降级后的层级生成
 */
export function preprocessMarkdown(text: string) {
	return mapOutsideFences(text, line => line
		.replace(/^(\s*:{3,})[ \t]+(?=[a-z])/i, '$1')
		.replace(/^( {0,3})#(?=[ \t])/, '$1##'))
}

/** 整个删掉的标签：可执行、可嵌入外部内容、可提交表单的 */
const DROPPED_TAGS = new Set([
	'base',
	'button',
	'embed',
	'form',
	'frame',
	'frameset',
	'iframe',
	'input',
	'link',
	'meta',
	'noscript',
	'object',
	'script',
	'select',
	'style',
	'template',
	'textarea',
])

const URL_PROPS = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xLinkHref', 'xlinkHref', 'xlink:href'])
/**
 * 事件属性与 Vue 的指令、绑定：`onerror`、`v-bind`、`v-on:click`、`:src`、`@click`、`#slot`。
 * mdc 会把 `v-bind` 的值当成对象摊成属性，`<span v-bind="$route.query">` 甚至能把网址参数变成属性，一律不要
 */
const DIRECTIVE_PROP = /^(?:on|v-|[:@#])/i
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

/** 相对地址、锚点与白名单协议放行；`javascript:` `data:` `vbscript:` 等一律不要 */
export function isSafeUrl(value: string) {
	// 浏览器解析协议前会忽略控制字符与空白，这里先同样去掉再判断
	const normalized = value.replace(/[\p{Cc}\s]/gu, '')
	const scheme = normalized.match(/^([a-z][a-z\d+.-]*):/i)?.[1]
	return !scheme || SAFE_SCHEMES.has(scheme.toLowerCase())
}

function sanitizeNode(node: MDCNode): MDCNode[] {
	if (node.type === 'comment')
		return []
	if (node.type !== 'element')
		return [node]
	const element = node as MDCElement
	// 任务列表的复选框：只保留只读的，其余 input 一律删掉
	if (element.tag === 'input' && element.props?.type === 'checkbox')
		return [{ ...element, props: { type: 'checkbox', disabled: true, checked: Boolean(element.props.checked) }, children: [] }]
	if (DROPPED_TAGS.has(element.tag.toLowerCase()))
		return []
	if (element.tag === 'h1')
		element.tag = 'h2'
	for (const [key, value] of Object.entries(element.props ?? {})) {
		// 属性值是对象的只会来自绑定语法（正常属性是字符串、数字、布尔或 className 那样的数组）
		const bound = value !== null && typeof value === 'object' && !Array.isArray(value)
		if (DIRECTIVE_PROP.test(key) || bound || (URL_PROPS.has(key) && typeof value === 'string' && !isSafeUrl(value)))
			delete element.props![key]
	}
	// 链接卡片的 `link`、`icon` 也是地址（别的组件的 icon 是图标名，所以只对它查）：不安全的删掉，没了 link 整个不要
	if (element.tag === 'link-card') {
		for (const key of ['link', 'icon']) {
			const value = element.props?.[key]
			if (typeof value !== 'string' || !isSafeUrl(value))
				delete element.props![key]
		}
		if (!element.props?.link)
			return []
	}
	element.children = sanitizeChildren(element.children)
	// 链接去掉 href 后只留文字（ProseA 要求 href 必填）；图片没了地址就整个删掉
	if (element.tag === 'a' && !element.props?.href)
		return element.children
	if ((element.tag === 'img' || element.tag === 'pic') && !element.props?.src)
		return []
	return [element]
}

function sanitizeChildren(children: MDCNode[] = []) {
	return children.flatMap(sanitizeNode)
}

/**
 * mdc 自己会去掉 `on*` 属性和 `javascript:` 链接，但**保留 `<script>`**（实测），
 * 所以这里再过一遍，不依赖它那一层。就地修改并返回同一棵树。
 */
export function sanitizeBody(body: MDCRoot) {
	body.children = sanitizeChildren(body.children)
	return body
}

const el = (tag: string, props: Record<string, unknown> = {}, children: MDCNode[] = []): MDCElement => ({ type: 'element', tag, props, children })

const GFM_ALERT_TYPES: Record<string, string> = { NOTE: 'info', TIP: 'tip', IMPORTANT: 'question', WARNING: 'warning', CAUTION: 'error' }
// banner 的投影 `::: ${bannerType}`，与路径 A 的 BANNER_TYPES 一致
const BANNER_CONTAINER_TYPES: Record<string, string> = { note: 'info', info: 'info', secondary: 'info', tip: 'tip', success: 'tip', warning: 'warning', error: 'error', danger: 'error' }

/**
 * mx 的行内扩展，mdc 不认，在文本节点里就地改写。与 `@haklex/rich-headless` 的投影规则对应：
 * `||剧透||`、`{GH@handle}`、`==高亮==`、`++插入++`（下划线）、`^上标^`、`~下标~`（删除线是双波浪线，GFM 的单波浪线删除线已关掉）
 */
const INLINE_EXTENSION = /\|\|(?<spoiler>.+?)\|\||\{(?<platform>GH|TW|TG)@(?<handle>[\w.-]+)\}|==(?<mark>[^=\n]+)==|\+\+(?<ins>[^+\n]+)\+\+|\^(?<sup>[^^\s]+)\^|~(?<sub>[^~\s]+)~/g
/** 提及的平台：两条路径共用（路径 A 的 mention 节点、路径 B 的 `{GH@handle}`） */
export const MENTION_PLATFORMS: Record<string, { host: string, name: string }> = {
	GH: { host: 'https://github.com/', name: 'GitHub' },
	TW: { host: 'https://x.com/', name: 'X' },
	TG: { host: 'https://t.me/', name: 'Telegram' },
}

/** 提及链接的可访问名称要含平台（读屏只念 `@octocat` 听不出是哪儿的账号）；显示的是昵称时把昵称放在前面 */
export function mentionLabelOf(platform: string, handle: string, displayName?: string, ui: UiLang = 'zh') {
	const account = translate(ui, 'content.user', { platform: MENTION_PLATFORMS[platform]?.name ?? platform, handle })
	return displayName ? translate(ui, 'content.mentionWithName', { name: displayName, account }) : account
}

/** 提及链接：两条路径输出同一个样子（路径 A 见 lexical.ts 的 mentionNode） */
function mentionLink(platform: string, handle: string, displayName: string | undefined, ui: UiLang): MDCNode {
	return el('a', { 'href': `${MENTION_PLATFORMS[platform]!.host}${handle}`, 'rel': ['nofollow'], 'aria-label': mentionLabelOf(platform, handle, displayName, ui) }, [{ type: 'text', value: displayName || `@${handle}` }])
}

const MENTION_HEAD = /^\{(GH|TW|TG)@([\w.-]+)\}/
const MAILTO_MENTION = /^mailto:(GH|TW|TG)@([\w.-]+)$/

const textOf = (node: MDCNode | undefined) => node?.type === 'text' ? String((node as { value: string }).value) : undefined
/** 只含文字的 span（mdc 把 `[昵称]` 解析成它） */
function plainSpanText(node: MDCNode | undefined) {
	if (node?.type !== 'element' || (node as MDCElement).tag !== 'span' || Object.keys((node as MDCElement).props ?? {}).length)
		return undefined
	const children = (node as MDCElement).children ?? []
	return children.length === 1 ? textOf(children[0]) : undefined
}

/**
 * mdc 会把 mx 的提及拆开：`[昵称]{GH@octocat}` 的 `[昵称]` 被当成 span 截走；账号带点时（`{TG@some.one}`）
 * GFM 又把 `TG@some.one` 认成邮箱、变成 mailto 链接。这里把这两种拆开的样子合回一个提及链接
 */
function mergeMentions(input: MDCNode[], ui: UiLang): MDCNode[] {
	const nodes = [...input]
	const out: MDCNode[] = []
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!
		const name = plainSpanText(node)
		// [昵称]{GH@octocat}：span 后面紧跟以提及开头的文字
		const head = name !== undefined ? textOf(nodes[i + 1])?.match(MENTION_HEAD) : undefined
		if (name !== undefined && head) {
			out.push(mentionLink(head[1]!, head[2]!, name, ui))
			const rest = textOf(nodes[i + 1])!.slice(head[0].length)
			// 剩下的文字放回去接着判断（后面可能紧跟着下一个被拆开的提及）
			if (rest)
				nodes[i + 1] = { type: 'text', value: rest }
			else
				i++
			continue
		}
		// 「{」+ mailto:GH@x.y + 「}」，前面可能还有 [昵称] 的 span
		const before = textOf(node)
		const link = nodes[i + 1] as MDCElement | undefined
		const after = textOf(nodes[i + 2])
		const mailto = link?.type === 'element' && link.tag === 'a' ? String(link.props?.href ?? '').match(MAILTO_MENTION) : undefined
		if (before?.endsWith('{') && mailto && after?.startsWith('}')) {
			const prefix = before.slice(0, -1)
			const spanName = prefix === '' ? plainSpanText(out.at(-1)) : undefined
			if (spanName !== undefined)
				out.pop()
			else if (prefix)
				out.push({ type: 'text', value: prefix })
			out.push(mentionLink(mailto[1]!, mailto[2]!, spanName, ui))
			if (after.length > 1) {
				nodes[i + 2] = { type: 'text', value: after.slice(1) }
				i++
			}
			else {
				i += 2
			}
			continue
		}
		out.push(node)
	}
	return out
}

function inlineNode(groups: Record<string, string | undefined>, ui: UiLang): MDCNode {
	const text = (value: string | undefined): MDCNode[] => [{ type: 'text', value: value ?? '' }]
	if (groups.spoiler !== undefined)
		return el('blur', {}, text(groups.spoiler))
	if (groups.handle !== undefined)
		return mentionLink(groups.platform!, groups.handle, undefined, ui)
	if (groups.mark !== undefined)
		return el('mark', {}, text(groups.mark))
	if (groups.ins !== undefined)
		return el('u', {}, text(groups.ins))
	if (groups.sup !== undefined)
		return el('sup', {}, text(groups.sup))
	return el('sub', {}, text(groups.sub))
}

function expandInline(value: string, ui: UiLang): MDCNode[] {
	const out: MDCNode[] = []
	let last = 0
	for (const match of value.matchAll(INLINE_EXTENSION)) {
		if (match.index > last)
			out.push({ type: 'text', value: value.slice(last, match.index) })
		out.push(inlineNode(match.groups ?? {}, ui))
		last = match.index + match[0].length
	}
	if (!out.length)
		return [{ type: 'text', value }]
	if (last < value.length)
		out.push({ type: 'text', value: value.slice(last) })
	return out
}

/** 路径 B 里映射出来的组件标签（与路径 A 输出的同一批） */
const COMPONENT_TAGS = new Set(['alert', 'blur', 'card-list', 'folding', 'link-card', 'mermaid', 'pic', 'video-embed'])
/** KaTeX 以外偶尔会出现的 SVG / MathML 元素，不当未知标签处理 */
const FOREIGN_TAGS = new Set(['svg', 'path', 'g', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'use', 'math', 'mi', 'mn', 'mo', 'mrow', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'semantics', 'annotation'])

const BLOCK_NODE_TAGS = new Set(['alert', 'card-list', 'div', 'folding', 'link-card', 'mermaid', 'p', 'pic', 'video-embed'])
const isBlockNode = (node: MDCNode) => node.type === 'element' && BLOCK_NODE_TAGS.has((node as MDCElement).tag)

/** 视频嵌入：`type` 与 `id` 不合格就整个不要；只留组件认得、且类型对的属性 */
function videoEmbedOf(type: unknown, id: unknown, poster: unknown, extra: Record<string, unknown> = {}): MDCNode[] {
	if (!videoSrcOf(type, id))
		return []
	const props: Record<string, unknown> = { type, id }
	const posterUrl = type === 'raw' ? mediaUrlOf(poster) : undefined
	if (posterUrl)
		props.poster = posterUrl
	for (const key of ['ratio', 'width', 'height'] as const) {
		const value = extra[key]
		if ((typeof value === 'string' && /^[\d.\s/%a-z]{1,16}$/i.test(value)) || typeof value === 'number')
			props[key] = value
	}
	return [el('video-embed', props)]
}

const unsupported = (ui: UiLang) => el('p', { className: ['mx-unsupported'] }, [el('em', {}, [{ type: 'text', value: translate(ui, 'content.contentCantShown') }])])

/** `plain`：链接里面，文字不做行内扩展（链接文字多是网址，`~user/`、`a^b`），但元素照常规整；`ui`：占位与提及的可访问名称用的界面语言 */
function normalizeNode(node: MDCNode, plain: boolean, ui: UiLang): MDCNode[] {
	if (node.type === 'text')
		return plain ? [node] : expandInline((node as { value: string }).value, ui)
	if (node.type !== 'element')
		return [node]
	const element = node as MDCElement
	const props = element.props ?? {}
	// 代码与公式里的 || 和 {GH@x} 不是扩展语法（比如范数 ||x||），整棵跳过
	const className = Array.isArray(props.className) ? props.className : []
	if (className.includes('katex') || className.includes('katex-display') || element.tag === 'math')
		return [element]
	// 链接文字多是网址（~user/、a^b），不做行内扩展；里面的元素照常规整，不认的组件同样给占位
	if (element.tag === 'a')
		return [{ ...element, children: (element.children ?? []).flatMap(child => normalizeNode(child, true, ui)) }]
	if (element.tag === 'pre' || element.tag === 'code') {
		if (element.tag === 'pre' && props.language === 'mermaid')
			return [el('mermaid', { code: String(props.code ?? '') })]
		return [element]
	}
	const children = mergeMentions(element.children ?? [], ui).flatMap(child => normalizeNode(child, plain, ui))

	// GFM alert：mdc 解析成「引用块首段以 span("!NOTE") 开头」
	if (element.tag === 'blockquote') {
		const first = children[0] as MDCElement | undefined
		const marker = first?.tag === 'p' ? first.children?.[0] as MDCElement | undefined : undefined
		const label = marker?.tag === 'span' && marker.children?.[0]?.type === 'text' ? String((marker.children[0] as { value: string }).value) : ''
		const type = GFM_ALERT_TYPES[label.replace(/^!/, '').toUpperCase()]
		if (type && label.startsWith('!')) {
			const rest = (first!.children ?? []).slice(1)
			if (rest[0]?.type === 'text')
				rest[0] = { type: 'text', value: (rest[0] as { value: string }).value.replace(/^\s+/, '') }
			const body = rest.length ? [el('p', {}, rest), ...children.slice(1)] : children.slice(1)
			return [el('alert', { type }, body)]
		}
	}
	if (element.tag === 'details')
		return [el('folding', { title: String(props.summary ?? '') }, children)]
	if (BANNER_CONTAINER_TYPES[element.tag])
		return [el('alert', { type: BANNER_CONTAINER_TYPES[element.tag] }, children)]
	if (element.tag === 'grid')
		return [el('card-list', {}, [el('ul', {}, children.map(child => (child as MDCElement).tag === 'li' ? child : el('li', {}, [child])))])]
	if (element.tag === 'cell')
		return [el('li', {}, children)]
	if (element.tag === 'tag')
		return [el('span', { className: ['mx-tag'] }, [{ type: 'text', value: `#${children.map(c => (c as { value?: string }).value ?? '').join('').trim()}` }])]
	// video 的投影 `<video src="…" controls>`，与路径 A 一样走 VideoEmbed
	if (element.tag === 'video')
		return videoEmbedOf('raw', props.src, props.poster)
	// 直接写的 `::video-embed{type id}`：平台与 id 按格式校验，只留认得的属性（组件里还会再校验一次）
	if (element.tag === 'video-embed')
		return videoEmbedOf(props.type ?? 'raw', props.id, props.poster, props)
	if (element.tag === 'nested-doc')
		return [el('div', { className: ['mx-nested-doc'] }, children)]
	// 段落里映射出了块级元素（行内 HTML 的 <video>、未知标签的占位）时拆开段落，<p> 里不能套块级元素
	if (element.tag === 'p' && children.some(isBlockNode)) {
		const out: MDCNode[] = []
		let run: MDCNode[] = []
		const flush = () => {
			if (run.some(n => n.type !== 'text' || /\S/.test((n as { value?: string }).value ?? '')))
				out.push({ ...element, children: run })
			run = []
		}
		for (const child of children) {
			if (isBlockNode(child)) {
				flush()
				out.push(child)
			}
			else {
				run.push(child)
			}
		}
		flush()
		return out
	}
	// core 投影的股票、地图、相册（`<node type data />`）：照 Lexical 的同一套校验转成同样的块。
	// HTML 不把 `<node />` 当自闭合标签，后面的内容会被解析成它的子节点：原样接在块后面，不能丢
	if (element.tag === 'node')
		return [liteXmlBlockOf(element.props ?? {}, ui) ?? unsupported(ui), ...children]
	// 未知标签（认不出的 <node>、excalidraw、废止的 MDC 组件……）给占位，不交给渲染器去猜
	if (!htmlTags.has(element.tag) && !COMPONENT_TAGS.has(element.tag) && !FOREIGN_TAGS.has(element.tag))
		return [unsupported(ui)]
	return [{ ...element, children }]
}

/**
 * 把路径 B 的容器与行内扩展映射到与路径 A 相同的组件，
 * 两条路径因此渲染出同一套组件。就地修改并返回同一棵树。
 */
export function normalizeMarkdownBody(body: MDCRoot, ui: UiLang = 'zh') {
	body.children = (body.children ?? []).flatMap(node => normalizeNode(node, false, ui))
	return body
}

export async function renderMarkdownBody(text: string, ui: UiLang = 'zh'): Promise<RenderedBody> {
	const parsed = await parseMarkdown(preprocessMarkdown(text), {
		highlight: false,
		toc: { depth: 4, searchDepth: 4 },
		remark: {
			plugins: {
				'remark-math': { instance: remarkMath },
				// mx 里单波浪线是下标（~x~），删除线是 ~~x~~；关掉 GFM 的单波浪线删除线，交给 expandInline
				'remark-gfm': { options: { singleTilde: false } },
			},
		},
		rehype: { plugins: { 'rehype-katex': { instance: rehypeKatex } } },
	})
	return { body: sanitizeBody(normalizeMarkdownBody(parsed.body, ui)), toc: parsed.toc }
}
