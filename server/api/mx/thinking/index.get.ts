import { withPublicQuote, withWindowTitlePolicy } from '~~/app/utils/mx/home'
import { loadThinking } from '~~/app/utils/mx/notes'

/** 第一页全站缓存：固定键，一分钟最多打 core 一次 */
const getCachedLatestThinking = defineCachedFunction(
	() => loadThinking(useServerMxClient()),
	{ name: 'mx-thinking', maxAge: 60, swr: true, getKey: () => 'latest' },
)

/**
 * 碎碎念，游标翻页。引用的内容只在公开集合里对得上时才保留。带 `before` 的页不缓存、转发访客 IP：游标由访客随意填，
 * 按它建缓存会一直占内存（swr 下缓存不过期），也会让未命中的请求都用主题自己的 IP 去问 core
 */
export default defineEventHandler(async (event) => {
	const before = snowflakeOf(getQuery(event).before)
	try {
		const [page, index, theme] = await Promise.all([
			before ? loadThinking(useServerMxClient(event), before) : getCachedLatestThinking(),
			getPublicIndex(),
			getThemeConfigWithTimeZone(),
		])
		return { ...page, items: page.items.map(item => withWindowTitlePolicy(withPublicQuote(item, index), theme.liveDesk.showWindowTitle)) }
	}
	catch (error) {
		throw toHttpError(error)
	}
})
