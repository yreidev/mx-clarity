import { loadProjects } from '~~/app/utils/mx/explore'

/** 项目，缓存 10 分钟 */
export default defineCachedEventHandler(async () => {
	try {
		return await loadProjects(useServerMxClient())
	}
	catch (error) {
		throw toHttpError(error)
	}
}, { name: 'mx-projects', maxAge: 600, swr: true, getKey: () => 'all' })
