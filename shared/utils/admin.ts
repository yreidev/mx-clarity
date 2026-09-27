/**
 * admin 里编辑某篇内容的地址。admin 是 hash 路由（`#/posts/edit?id=…`，日记 `notes`、独立页 `pages`）。
 * `adminUrl` 取主题配置的，没填就是单域名部署的默认位置：站点地址加 `/proxy/qaqdmin`。纯函数
 */
const KINDS = { post: 'posts', note: 'notes', page: 'pages' } as const

/** 内容的站内地址 → 类型：`/posts/分类/slug` 是文章，`/notes/nid` 是日记，其余一段的是独立页 */
export function contentKindOf(path: string | undefined): keyof typeof KINDS | undefined {
	if (!path)
		return undefined
	if (/^\/posts\/[^/]+\/[^/]+$/.test(path))
		return 'post'
	if (/^\/notes\/\d+$/.test(path))
		return 'note'
	if (/^\/[^/]+$/.test(path))
		return 'page'
	return undefined
}

/** admin 的首页（控制台）；地址不是 http(s) 时是 undefined */
export function adminHomeUrlOf(options: { adminUrl?: string, webUrl?: string }) {
	const base = (options.adminUrl || (options.webUrl ? `${options.webUrl.replace(/\/+$/, '')}/proxy/qaqdmin` : '')).replace(/\/+$/, '')
	return /^https?:\/\//i.test(base) ? base : undefined
}

export function adminEditUrlOf(options: { adminUrl?: string, webUrl?: string, path?: string, id?: string }) {
	const kind = contentKindOf(options.path)
	const base = adminHomeUrlOf(options)
	if (!kind || !options.id || !base)
		return undefined
	return `${base}/#/${KINDS[kind]}/edit?id=${encodeURIComponent(options.id)}`
}
