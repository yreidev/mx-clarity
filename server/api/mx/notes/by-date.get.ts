import { loadNoteNidByDate, noteDatePathOf } from '~~/app/utils/mx/notes'

/** 日期加 slug 的日记地址换成 nid，页面据此 301 到 /notes/:nid。不缓存：参数由访客随意填 */
export default defineEventHandler(async (event) => {
	const query = getQuery(event)
	const path = noteDatePathOf(query.year, query.month, query.day, query.slug)
	if (!path)
		throw notFound()
	try {
		const nid = await loadNoteNidByDate(useServerMxClient(event), path)
		if (!nid)
			throw notFound()
		return { nid }
	}
	catch (error) {
		throw toHttpError(error)
	}
})
