/**
 * 评论正文 → 白名单结构。纯模块，只在服务端调用。
 *
 * 评论是匿名可写的，所以不走文章的渲染管线：先按 markdown 解析成 mdast，
 * 再只挑出白名单里的几种节点，其余降级成文字。结果交给组件用渲染函数生成节点，全程没有 HTML 字符串。
 */
import type { Nodes, PhrasingContent, RootContent } from 'mdast'
import type { CommentBlock, CommentInline } from '../../types/comment'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { safeUrl } from './adapter'
import { replaceOwo } from './owo'

export interface CommentBodyOptions {
	/**
	 * 评论里的图片，地址以这些前缀之一开头才在页面上显示（站点自己存储的：core 的 `/objects/image/`、站长列的 S3 域名），
	 * 其余只给一个链接。前缀要以 `/` 结尾
	 */
	imagePrefixes?: readonly string[]
}

/**
 * 评论图片在页面上显示的地址前缀：core 存在本地时是 `serverUrl` 下的 `/objects/image/`
 * （单域名部署时也就是站点的 `/api/v3/objects/image/`），存在 S3 时是主题配置 `comments.imageHosts` 里列的
 */
export function commentImagePrefixesOf(site: { webUrl?: string, serverUrl?: string } | undefined, extra: readonly string[] = []) {
	const prefixes = new Set(extra)
	const add = (base: string | undefined, path: string) => {
		try {
			if (base && /^https:\/\//i.test(base))
				prefixes.add(new URL(path, `${base.replace(/\/+$/, '')}/`).href)
		}
		catch {}
	}
	// 相对路径接在 core 地址后面；以 `/` 开头的从站点根上算
	add(site?.serverUrl, 'objects/image/')
	add(site?.webUrl, '/api/v3/objects/image/')
	return [...prefixes]
}

/**
 * 图片地址在站点自己的存储里：https，规范化以后以某个前缀开头。
 * `..` 已被 URL 解析掉；带用户名的（`https://站点@别处/`）规范化后主机前面多出一截，对不上前缀
 */
export function trustedImageOf(url: unknown, prefixes: readonly string[] = []) {
	if (typeof url !== 'string' || !/^https:\/\//i.test(url))
		return undefined
	try {
		const parsed = new URL(url)
		return prefixes.some(prefix => prefix.endsWith('/') && parsed.href.startsWith(prefix)) ? parsed.href : undefined
	}
	catch {
		return undefined
	}
}

/** 引用、列表、强调的嵌套层数上限；更深的只留文字 */
const MAX_DEPTH = 6

/** 节点里的全部文字（降级用） */
function plainText(node: Nodes): string {
	if ('value' in node)
		return node.value
	if (node.type === 'image' || node.type === 'imageReference')
		return node.alt ?? ''
	if ('children' in node)
		return (node.children as Nodes[]).map(plainText).join('')
	return ''
}

function pushText(out: CommentInline[], value: string) {
	if (!value)
		return
	const last = out.at(-1)
	if (last?.type === 'text')
		last.value += value
	else
		out.push({ type: 'text', value })
}

/** 评论里的单个换行就是换行：读者不会去记 markdown 行尾两个空格的规矩 */
function pushLines(out: CommentInline[], value: string) {
	value.split('\n').forEach((line, i) => {
		if (i > 0)
			out.push({ type: 'break' })
		pushText(out, line)
	})
	return out
}

function inlines(nodes: PhrasingContent[], depth: number, options: CommentBodyOptions): CommentInline[] {
	const out: CommentInline[] = []
	for (const node of nodes)
		appendInline(out, node, depth, options)
	return out
}

function appendInline(out: CommentInline[], node: PhrasingContent, depth: number, options: CommentBodyOptions) {
	switch (node.type) {
		case 'text':
			pushLines(out, replaceOwo(node.value))
			return
		// 原始 HTML 按字面显示：读者写的 `<b>` 就让它看起来是 `<b>`
		case 'html':
			pushLines(out, node.value)
			return
		case 'inlineCode':
			out.push({ type: 'code', value: node.value })
			return
		case 'break':
			out.push({ type: 'break' })
			return
		case 'strong':
		case 'emphasis':
		case 'delete': {
			if (depth >= MAX_DEPTH) {
				pushText(out, plainText(node))
				return
			}
			const type = node.type === 'strong' ? 'strong' : node.type === 'emphasis' ? 'em' : 'del'
			out.push({ type, children: inlines(node.children, depth + 1, options) })
			return
		}
		case 'link': {
			const href = safeUrl(node.url)
			const children = inlines(node.children, depth + 1, options)
			// 危险协议的链接展开成文字
			if (!href || depth >= MAX_DEPTH)
				children.forEach(child => child.type === 'text' ? pushText(out, child.value) : out.push(child))
			else
				out.push({ type: 'link', href, children: children.length ? children : [{ type: 'text', value: href }] })
			return
		}
		case 'image': {
			// 站点自己存储的图片直接显示；别处的不加载（第三方图片会拿到读者的 IP），只留一个指向原图的链接
			const src = trustedImageOf(node.url, options.imagePrefixes)
			if (src) {
				out.push({ type: 'image', src, alt: (node.alt ?? '').slice(0, 100) })
				return
			}
			const href = safeUrl(node.url)
			const label = node.alt ? `图片：${node.alt}` : '图片'
			if (href)
				out.push({ type: 'link', href, children: [{ type: 'text', value: label }] })
			else
				pushText(out, node.alt ?? '')
			return
		}
		case 'footnoteReference':
			pushText(out, `[^${node.label ?? node.identifier}]`)
			return
		default:
			// linkReference、imageReference 等没有定义可查的：只留文字
			pushText(out, plainText(node))
	}
}

function paragraph(children: CommentInline[]): CommentBlock[] {
	return children.length ? [{ type: 'paragraph', children }] : []
}

function blocks(nodes: RootContent[], depth: number, options: CommentBodyOptions): CommentBlock[] {
	return nodes.flatMap(node => block(node, depth, options))
}

function block(node: RootContent, depth: number, options: CommentBodyOptions): CommentBlock[] {
	switch (node.type) {
		case 'paragraph':
		case 'heading':
			return paragraph(inlines(node.children, depth, options))
		case 'code':
			return [{ type: 'code', value: node.value }]
		case 'html':
			return paragraph(pushLines([], node.value))
		case 'blockquote':
			return depth >= MAX_DEPTH
				? paragraph([{ type: 'text', value: plainText(node) }])
				: [{ type: 'quote', children: blocks(node.children, depth + 1, options) }]
		case 'list':
			return depth >= MAX_DEPTH
				? paragraph([{ type: 'text', value: plainText(node) }])
				: [{ type: 'list', ordered: Boolean(node.ordered), items: node.children.map(item => blocks(item.children, depth + 1, options)) }]
		case 'table':
			// 表格只留单元格文字，一行一段
			return node.children.flatMap(row => paragraph([{ type: 'text', value: row.children.map(cell => plainText(cell).trim()).join(' | ') }]))
		case 'footnoteDefinition':
			return blocks(node.children, depth, options)
		case 'thematicBreak':
		case 'definition':
			return []
		default:
			return paragraph([{ type: 'text', value: plainText(node) }])
	}
}

export function renderCommentBody(text: string, options: CommentBodyOptions = {}): CommentBlock[] {
	const tree = fromMarkdown(text, {
		// 单波浪线不算删除线，免得「1~2 天」被误伤
		extensions: [gfm({ singleTilde: false })],
		mdastExtensions: [gfmFromMarkdown()],
	})
	return blocks(tree.children, 0, options)
}

function blockText(block: CommentBlock): string {
	const inline = (node: CommentInline): string => {
		switch (node.type) {
			case 'text':
			case 'code':
				return node.value
			case 'break':
				return ' '
			case 'image':
				return node.alt ? `[${node.alt}]` : '[图片]'
			default:
				return node.children.map(inline).join('')
		}
	}
	switch (block.type) {
		case 'paragraph':
			return block.children.map(inline).join('')
		case 'code':
			return block.value
		case 'quote':
			return block.children.map(blockText).join(' ')
		case 'list':
			return block.items.map(item => item.map(blockText).join(' ')).join(' ')
	}
}

/** 评论（或碎碎念）正文的纯文本开头：过同一套白名单再取文字，表情名照样换成表情；超长截断加省略号 */
export function commentExcerptOf(text: string, max: number) {
	const plain = renderCommentBody(text.slice(0, 4000)).map(blockText).join(' ').replace(/\s+/g, ' ').trim()
	return plain.length > max ? `${plain.slice(0, max)}…` : plain
}
