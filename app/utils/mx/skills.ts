/**
 * 文章附带的 Skill（core 的 snippet `sk/<名称>/SKILL.md`）。纯模块，由 server 路由调用。
 *
 * SKILL.md 是站长写的 markdown，照样按半可信处理：走路径 B 的渲染与白名单（脚本去掉）；
 * 开头的 `---` 里只取 `name`、`description`；正文里的相对链接与图片改写到本站的附件转发 `/skills/<名称>/<路径>`
 */
import type { MDCNode, MDCRoot } from '@nuxtjs/mdc'

export const SKILL_NAME = /^(?!\.{1,2}$)[\w.-]{1,64}$/

/** `$meta.skills[].rawUrl`（`…/s/sk/<名称>/SKILL.md`）里的名称 */
export function skillNameOfRawUrl(value: unknown) {
	if (typeof value !== 'string')
		return undefined
	const name = /\/s\/sk\/([\w.-]{1,64})\/SKILL\.md$/.exec(value.split(/[?#]/)[0]!)?.[1]
	return name && SKILL_NAME.test(name) ? name : undefined
}

/** 附件路径：每段都要像文件名，不许 `.`、`..`、空段与 `#?\\` */
export function skillAssetPathOf(segments: unknown): string | undefined {
	const parts = Array.isArray(segments) ? segments : typeof segments === 'string' ? segments.split('/') : []
	if (!parts.length || parts.length > 8)
		return undefined
	return parts.every(part => typeof part === 'string' && /^[\w.-]{1,100}$/.test(part) && part !== '.' && part !== '..') ? parts.join('/') : undefined
}

/** 开头的 `---` 块：只认 `name`、`description`（单行，可带引号）；返回去掉它与正文第一个标题之后的 markdown */
export function parseSkillMarkdown(text: string) {
	let body = text.replace(/^\uFEFF/, '')
	const meta: { name?: string, description?: string } = {}
	const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body)
	if (front) {
		for (const line of front[1]!.split(/\r?\n/)) {
			const at = line.indexOf(':')
			const key = line.slice(0, at).trim()
			if (at > 0 && (key === 'name' || key === 'description'))
				meta[key] = line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2').slice(0, 300)
		}
		body = body.slice(front[0].length)
	}
	body = body.replace(/^\s*#\s+[^\n]*\n?/, '')
	return { ...meta, body }
}

const EXTERNAL = /^(?:[a-z][\w+.-]*:|\/|#)/i

/** 渲染好的正文里，相对的链接与图片改写到 `/skills/<名称>/<路径>`；就地修改 */
export function rewriteSkillLinks(body: MDCRoot, name: string) {
	const rewrite = (value: unknown) => {
		if (typeof value !== 'string' || !value || EXTERNAL.test(value))
			return value
		const [path = '', hash] = value.split('#')
		const clean = skillAssetPathOf(path.replace(/^\.\//, ''))
		return clean ? `/skills/${name}/${clean}${hash ? `#${hash}` : ''}` : value
	}
	const walk = (nodes: MDCNode[] = []) => {
		for (const node of nodes) {
			if (node.type !== 'element')
				continue
			if (node.props?.href)
				node.props.href = rewrite(node.props.href)
			if (node.props?.src)
				node.props.src = rewrite(node.props.src)
			walk(node.children)
		}
	}
	walk(body.children)
	return body
}
