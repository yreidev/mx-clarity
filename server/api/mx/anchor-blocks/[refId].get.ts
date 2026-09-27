/**
 * 这篇正文的块（块 id → 类型与文字）：划词评论在浏览器里核对引用、重建锚点、画高亮都按它。
 * 以匿名身份取的正文算（付费锁定的部分不在里面），全站缓存 30 秒（server/utils/anchor.ts）；不是 Lexical 正文、取不到时 `blocks` 是 null
 */
export default defineEventHandler(async (event) => {
	const refId = snowflakeOf(getRouterParam(event, 'refId'))
	if (!refId)
		throw notFound()
	return { blocks: (await getAnchorBlocks(refId, event)) ?? null }
})
