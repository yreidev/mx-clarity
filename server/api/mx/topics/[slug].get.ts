import { loadTopicDetail } from '~~/app/utils/mx/notes'

/**
 * 专栏详情与其中的日记。与日记详情一样不缓存、转发访客 IP：slug 由访客随意填，
 * 查不到的请求进不了缓存，以主题自己的 IP 去问 core 会用掉所有访客共享的限流配额
 */
export default defineEventHandler(async (event) => {
	const slug = segmentOf(getRouterParam(event, 'slug', { decode: true }))
	if (!slug)
		throw notFound()
	try {
		return await loadTopicDetail(useServerMxClient(event, { lang: await requestLangOf(event) }), encodeURIComponent(slug), pageOf(event))
	}
	catch (error) {
		throw toHttpError(error)
	}
})
