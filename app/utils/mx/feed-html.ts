/**
 * 订阅源条目的全文 HTML。纯模块，只在服务端生成订阅源时用。
 *
 * 输入是两条渲染路径的产物（MDC AST，已经过 `sanitizeBody`），这里再过一道**订阅源专用、更严的白名单**，
 * 自己拼出转义好的 HTML 字符串：
 * - 标签只留排版用的几十个；主题的自定义组件降级成普通 HTML（剧透不输出内容、图表给源码、视频与链接卡片给链接）；
 * - svg、iframe、表单、脚本、样式整个丢掉；公式换成 TeX 源码（KaTeX 靠 style 排版，属性去掉就乱，MathML 也不值得冒险）；
 * - 属性按标签列白名单，`href` 只收 http(s)、mailto 与锚点，`src` 只收 https，相对地址按站点地址转成绝对地址；
 * - 每条最多约 100 KB，超了截到上一个完整的块。
 * 订阅源的 XSL 不再把正文当 HTML 插进页面（`public/assets/atom.xsl`），全文只给阅读器
 */
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import { videoSrcOf } from '~~/shared/utils/video'
import { escapeXml as escape } from './feed'
import { pollOptionsOf } from './rich-blocks'

export const FEED_ENTRY_MAX = 100_000

const KEEP = new Set(['p', 'br', 'hr', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code', 'kbd', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'a', 'img', 'figure', 'figcaption', 'ruby', 'rt', 'rp', 'details', 'summary'])
const VOID = new Set(['br', 'hr', 'img'])
/** 连同子节点整个丢掉 */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'option', 'video', 'audio', 'source', 'track', 'svg', 'math', 'link', 'meta', 'base', 'template', 'noscript', 'canvas', 'frame', 'frameset', 'slot'])
const ALERT_LABELS: Record<string, string> = { info: '提示', tip: '提示', note: '提示', warning: '注意', error: '警告' }
const DIGITS = /^\d{1,4}$/
const LANGUAGE = /^language-[a-z0-9+#-]{1,30}$/i
const CONTROL = /[\p{Cc}\s]/gu

interface Context {
	/** 站点地址，相对地址按它转成绝对地址 */
	base: string
	/** 这一条在站点上的地址，站内锚点接在它后面 */
	link: string
}

function propOf(element: MDCElement, key: string) {
	return (element.props ?? {})[key]
}

function stringProp(element: MDCElement, key: string) {
	const value = propOf(element, key)
	return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function classesOf(element: MDCElement): string[] {
	const value = propOf(element, 'className') ?? propOf(element, 'class')
	return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : []
}

/** 地址先去掉控制字符与空白再判断协议（浏览器也是这么解析的） */
function absoluteUrl(value: string, ctx: Context, kind: 'href' | 'src') {
	const raw = value.replace(CONTROL, '')
	if (!raw)
		return undefined
	if (kind === 'href' && raw.startsWith('#'))
		return `${ctx.link}${raw}`
	let url: URL
	try {
		url = new URL(raw, ctx.base)
	}
	catch {
		return undefined
	}
	const relative = !/^[a-z][a-z\d+.-]*:/i.test(raw)
	if (kind === 'src')
		return url.protocol === 'https:' || (relative && url.protocol === 'http:') ? url.href : undefined
	return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : undefined
}

function textOf(node: MDCNode): string {
	if (node.type === 'text')
		return node.value
	return node.type === 'element' ? (node.children ?? []).map(textOf).join('') : ''
}

function tag(name: string, attrs: Record<string, string | undefined>, inner?: string) {
	const attributes = Object.entries(attrs).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => ` ${key}="${escape(value!)}"`).join('')
	return inner === undefined ? `<${name}${attributes} />` : `<${name}${attributes}>${inner}</${name}>`
}

/** KaTeX 的产物里取 TeX 源码（`annotation[encoding="application/x-tex"]`） */
function texOf(node: MDCNode): string | undefined {
	if (node.type !== 'element')
		return undefined
	if (node.tag === 'annotation' && stringProp(node, 'encoding') === 'application/x-tex')
		return textOf(node)
	for (const child of node.children ?? []) {
		const tex = texOf(child)
		if (tex !== undefined)
			return tex
	}
	return undefined
}

function children(element: MDCElement | MDCRoot, ctx: Context) {
	return (element.children ?? []).map(child => nodeHtml(child, ctx)).join('')
}

function componentHtml(element: MDCElement, ctx: Context): string | undefined {
	switch (element.tag) {
		case 'alert':
			return tag('blockquote', {}, `${tag('p', {}, tag('strong', {}, escape(ALERT_LABELS[stringProp(element, 'type')] ?? '提示')))}${children(element, ctx)}`)
		case 'folding':
			return tag('details', {}, `${tag('summary', {}, escape(stringProp(element, 'title') || '展开'))}${children(element, ctx)}`)
		case 'blur':
			return tag('span', {}, '〔剧透内容，请到原文查看〕')
		case 'mermaid':
			return tag('pre', {}, tag('code', {}, escape(stringProp(element, 'code'))))
		case 'video-embed': {
			const src = videoSrcOf(propOf(element, 'type'), propOf(element, 'id'))
			const href = src && absoluteUrl(src, ctx, 'href')
			return href ? tag('p', {}, tag('a', { href, rel: 'noopener noreferrer nofollow' }, '〔视频〕')) : ''
		}
		case 'pic': {
			const src = absoluteUrl(stringProp(element, 'src'), ctx, 'src')
			if (!src)
				return ''
			const caption = stringProp(element, 'caption')
			return tag('figure', {}, `${tag('img', { src, alt: stringProp(element, 'alt') || caption })}${caption ? tag('figcaption', {}, escape(caption)) : ''}`)
		}
		case 'link-card': {
			const href = absoluteUrl(stringProp(element, 'link'), ctx, 'href')
			if (!href)
				return ''
			const description = stringProp(element, 'description')
			return tag('p', {}, `${tag('a', { href, rel: 'noopener noreferrer nofollow' }, escape(stringProp(element, 'title') || href))}${description ? `：${escape(description)}` : ''}`)
		}
		case 'mx-gallery':
			return children(element, ctx)
		case 'file-card': {
			const href = absoluteUrl(stringProp(element, 'src'), ctx, 'href')
			const size = stringProp(element, 'size')
			return href ? tag('p', {}, `〔附件〕${tag('a', { href, rel: 'noopener noreferrer nofollow' }, escape(stringProp(element, 'name') || '下载'))}${size ? `（${escape(size)}）` : ''}`) : ''
		}
		case 'mx-poll': {
			const items = pollOptionsOf(propOf(element, 'options')).map(option => tag('li', {}, escape(option.label))).join('')
			return tag('blockquote', {}, `${tag('p', {}, tag('strong', {}, `投票：${escape(stringProp(element, 'question'))}`))}${items ? tag('ul', {}, items) : ''}${tag('p', {}, tag('a', { href: ctx.link }, '到原文参与投票'))}`)
		}
		case 'stock-block': {
			const price = propOf(element, 'price')
			const name = stringProp(element, 'name')
			const quote = typeof price === 'number' && Number.isFinite(price) ? `：${price} ${escape(stringProp(element, 'currency'))}` : ''
			return tag('p', {}, `〔股票 ${escape(stringProp(element, 'symbol'))}${name ? `（${escape(name)}）` : ''}${quote}〕`)
		}
		case 'map-block': {
			let names: string[] = []
			try {
				const pois = JSON.parse(stringProp(element, 'pois') || '[]')
				names = Array.isArray(pois) ? pois.map(poi => typeof poi?.title === 'string' ? poi.title : '').filter(Boolean).slice(0, 20) : []
			}
			catch {}
			return `${tag('p', {}, `〔地图${stringProp(element, 'title') ? `：${escape(stringProp(element, 'title'))}` : ''}〕`)}${names.length ? tag('ul', {}, names.map(name => tag('li', {}, escape(name))).join('')) : ''}`
		}
		case 'chat':
			// `{名字}`、`{.名字}` 起一段发言
			return tag('blockquote', {}, (element.children ?? []).map((child) => {
				const who = textOf(child).match(/^\{\.?(.+)\}$/)?.[1]
				return who ? tag('p', {}, tag('strong', {}, `${escape(who)}：`)) : nodeHtml(child, ctx)
			}).join(''))
	}
	return undefined
}

function attrsOf(element: MDCElement, ctx: Context): Record<string, string | undefined> | undefined {
	switch (element.tag) {
		case 'a': {
			const href = absoluteUrl(stringProp(element, 'href'), ctx, 'href')
			return { href, title: stringProp(element, 'title') || undefined, rel: href ? 'noopener noreferrer nofollow' : undefined }
		}
		case 'img': {
			const src = absoluteUrl(stringProp(element, 'src'), ctx, 'src')
			if (!src)
				return undefined
			const size = (key: string) => DIGITS.test(stringProp(element, key)) ? stringProp(element, key) : undefined
			return { src, alt: stringProp(element, 'alt'), title: stringProp(element, 'title') || undefined, width: size('width'), height: size('height') }
		}
		case 'th':
		case 'td': {
			const numberOf = (...names: string[]) => names.map(name => stringProp(element, name)).find(value => DIGITS.test(value))
			const align = stringProp(element, 'align')
			return { colspan: numberOf('colSpan', 'colspan'), rowspan: numberOf('rowSpan', 'rowspan'), align: ['left', 'center', 'right'].includes(align) ? align : undefined }
		}
		case 'ol':
			return { start: DIGITS.test(stringProp(element, 'start')) ? stringProp(element, 'start') : undefined }
		case 'code':
		case 'pre':
			return { class: classesOf(element).find(name => LANGUAGE.test(name)) }
		default:
			return {}
	}
}

function nodeHtml(node: MDCNode, ctx: Context): string {
	if (node.type === 'text')
		return escape(node.value)
	if (node.type !== 'element')
		return ''
	const element = node
	if (DROP.has(element.tag))
		return ''
	const classes = classesOf(element)
	if (classes.includes('katex') || classes.includes('katex-display')) {
		const tex = texOf(element)
		if (tex === undefined)
			return ''
		return classes.includes('katex-display') ? tag('pre', {}, tag('code', {}, escape(tex))) : tag('code', {}, escape(tex))
	}
	const component = componentHtml(element, ctx)
	if (component !== undefined)
		return component
	// 代码块：mdc 的 pre 带着 `code` 原文，比子节点（高亮后的 span）干净
	if (element.tag === 'pre') {
		const code = stringProp(element, 'code') || textOf(element)
		const language = classesOf(element).find(name => LANGUAGE.test(name))
		return tag('pre', {}, tag('code', { class: language }, escape(code)))
	}
	const name = element.tag === 'h1' ? 'h2' : element.tag
	if (!KEEP.has(name))
		return children(element, ctx)
	const attrs = attrsOf(element, ctx)
	if (!attrs)
		return ''
	return VOID.has(name) ? tag(name, attrs) : tag(name, attrs, children(element, ctx))
}

/**
 * 正文 AST → 订阅源里的全文 HTML。按顶层块逐个拼，超过 `max` 就在上一个完整的块处截断，末尾说明「未完」
 */
export function feedHtmlOf(body: MDCRoot, ctx: Context, max = FEED_ENTRY_MAX) {
	let html = ''
	for (const block of body.children ?? []) {
		const next = nodeHtml(block, ctx)
		if (html.length + next.length > max) {
			html += tag('p', {}, `……（未完，${tag('a', { href: ctx.link }, '到原文阅读全文')}）`)
			break
		}
		html += next
	}
	return html
}
