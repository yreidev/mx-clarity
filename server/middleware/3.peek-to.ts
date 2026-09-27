/**
 * 站内链接预览打开时地址上带 `?peek-to=<目标>`（`Peek.vue`）。有人把这个地址分享出去、直接打开或刷新时，
 * 目标是本站的文章或日记路径就 302 过去；别的值一律忽略，照常渲染原来的页面
 */
export default defineEventHandler((event) => {
	if (event.method !== 'GET' || event.path.startsWith('/api/'))
		return
	const target = peekToPathOf(getQuery(event)[PEEK_PARAM])
	if (target)
		return sendRedirect(event, target, 302)
})
