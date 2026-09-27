import { withPublicQuote, withWindowTitlePolicy } from '~~/app/utils/mx/home'
import { loadThinkingItem } from '~~/app/utils/mx/notes'

/**
 * 单条碎碎念。与日记详情一样不缓存、转发访客 IP：id 由访客随意填，
 * 查不到的请求进不了缓存，以主题自己的 IP 去问 core 会用掉所有访客共享的限流配额
 */
export default defineEventHandler(async (event) => {
	const id = snowflakeOf(getRouterParam(event, 'id'))
	if (!id)
		throw notFound()
	const item = await loadThinkingItem(useServerMxClient(event), id).catch((error) => {
		throw toHttpError(error)
	})
	if (!item)
		throw notFound()
	const [index, theme] = await Promise.all([getPublicIndex(), getThemeConfigWithTimeZone()])
	return withWindowTitlePolicy(withPublicQuote(item, index), theme.liveDesk.showWindowTitle)
})
