import { loadSayPage } from '~~/app/utils/mx/notes'

/** 说说，按页缓存 */
export default defineCachedEventHandler(async (event) => {
	try {
		return await loadSayPage(useServerMxClient(), pageOf(event))
	}
	catch (error) {
		throw toHttpError(error)
	}
}, { name: 'mx-says', maxAge: 60, swr: true, getKey: event => `page-${pageOf(event)}` })
