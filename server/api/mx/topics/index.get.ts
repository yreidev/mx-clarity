import { loadTopics } from '~~/app/utils/mx/notes'
import { routeLangOf } from '~~/shared/utils/lang'

/** 专栏列表，按语言缓存 */
export default defineCachedEventHandler(async (event) => {
	try {
		return await loadTopics(useServerMxClient(undefined, { lang: await requestLangOf(event) }))
	}
	catch (error) {
		throw toHttpError(error)
	}
}, { name: 'mx-topics', maxAge: 600, swr: true, getKey: event => routeLangOf(getQuery(event).lang) ?? 'all' })
