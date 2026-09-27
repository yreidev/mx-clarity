import type { RecentActivity } from '~~/app/types/home'
import { classifyMxError } from '~~/app/utils/mx/errors'
import { loadRecentComments, loadRecentThinking } from '~~/app/utils/mx/home'

/** 最近的评论取自 `/activity/recent`，被评论的内容要在公开集合里对得上，对不上的整条丢掉；全站缓存 60 秒 */
const getCachedComments = defineCachedFunction(async () => {
	const [index, avatarHosts] = await Promise.all([getPublicIndex(), trustedAvatarHosts()])
	return loadRecentComments(useServerMxClient(), index, avatarHosts)
}, { name: 'mx-activity', maxAge: 60, swr: true, getKey: () => 'default' })

/** 最近的碎碎念取自 `/aggregate/top`，全站缓存 60 秒 */
const getCachedThinking = defineCachedFunction(
	() => loadRecentThinking(useServerMxClient()),
	{ name: 'mx-top', maxAge: 60, swr: true, getKey: () => 'default' },
)

/** 首页侧栏「最近动态」：最近的碎碎念与评论。哪一半拿不到就给空列表，不让整块失败 */
export default defineEventHandler(async (): Promise<RecentActivity> => {
	const degraded = (source: string) => (error: unknown) => {
		logDegraded(source, classifyMxError(error))
		return []
	}
	const [comments, thinking] = await Promise.all([
		getCachedComments().catch(degraded('activity')),
		getCachedThinking().catch(degraded('top')),
	])
	return { comments, thinking }
})
