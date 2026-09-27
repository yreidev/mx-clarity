import { loadNotePage } from '~~/app/utils/mx/notes'
import { routeLangOf } from '~~/shared/utils/lang'

/** 日记列表，按页、按语言缓存（键里的语言只认候选；没开的语言在里面按站点语言取） */
export default defineCachedEventHandler(async (event) => {
	try {
		return await loadNotePage(useServerMxClient(undefined, { lang: await requestLangOf(event) }), pageOf(event))
	}
	catch (error) {
		throw toHttpError(error)
	}
}, { name: 'mx-notes', maxAge: 60, swr: true, getKey: event => `${routeLangOf(getQuery(event).lang) ?? 'default'}:page-${pageOf(event)}` })
