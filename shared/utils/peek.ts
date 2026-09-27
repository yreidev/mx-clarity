/**
 * 站内链接预览（Peek）能不能接这个链接：只认文章 `/posts/:分类/:slug` 与日记 `/notes/:nid`，
 * 本站相对地址或同源（含站点配置里的 webUrl）的绝对地址才算；`/posts/tag/*`、`/notes/series/*`、别的站一概不认。纯函数
 */
export type PeekTarget
	= | { kind: 'post', category: string, slug: string, path: string }
		| { kind: 'note', nid: number, path: string }

const POST = /^\/posts\/(?!tag\/)([^/?#]+)\/([^/?#]+)\/?$/
const NOTE = /^\/notes\/([1-9]\d{0,8})\/?$/

/** 解一个路径段（分类、slug）拿去取数：解不开就不认这个链接，所以不用 link.ts 里解不开原样返回的那个 */
function decode(value: string) {
	try {
		return decodeURIComponent(value)
	}
	catch {
		return undefined
	}
}

/** `current` 是当前页的地址；`origins` 是认作本站的源（当前页的源、站点的 webUrl） */
export function peekTargetOf(href: string | null | undefined, current: string, origins: readonly string[]): PeekTarget | undefined {
	if (!href || href.startsWith('#'))
		return undefined
	let url: URL
	let here: URL
	try {
		url = new URL(href, current)
		here = new URL(current)
	}
	catch {
		return undefined
	}
	if (!/^https?:$/.test(url.protocol) || !origins.includes(url.origin))
		return undefined
	// 就是当前这一篇（脚注、标题的锚点按当前页解析后也会落到这里）
	if (url.pathname.replace(/\/$/, '') === here.pathname.replace(/\/$/, ''))
		return undefined
	const post = url.pathname.match(POST)
	if (post) {
		const category = decode(post[1]!)
		const slug = decode(post[2]!)
		return category && slug ? { kind: 'post', category, slug, path: `/posts/${post[1]}/${post[2]}` } : undefined
	}
	const note = url.pathname.match(NOTE)
	return note ? { kind: 'note', nid: Number(note[1]), path: `/notes/${note[1]}` } : undefined
}

/** 预览打开时地址上带的参数：分享出去的地址能直接打开那一篇（服务端把它 302 过去） */
export const PEEK_PARAM = 'peek-to'

/** `?peek-to=` 的值：只认本站的文章与日记路径（相对路径，不带协议与主机），其余 undefined */
export function peekToPathOf(value: unknown) {
	if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || value.startsWith('//'))
		return undefined
	const path = value.split(/[?#]/)[0]!
	return POST.test(path) || NOTE.test(path) ? path : undefined
}

/** 在地址上加或去掉 `peek-to`，别的参数与锚点原样 */
export function withPeekTo(href: string, path: string | undefined) {
	const url = new URL(href)
	if (path)
		url.searchParams.set(PEEK_PARAM, path)
	else
		url.searchParams.delete(PEEK_PARAM)
	return url.toString()
}
