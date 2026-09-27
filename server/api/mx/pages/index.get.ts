import type { PageLink } from '~~/app/utils/mx/pages'
import { classifyMxError } from '~~/app/utils/mx/errors'

/** 侧栏导航里的独立页；取不到时当作没有，侧栏只显示静态导航 */
export default defineEventHandler(async (event): Promise<PageLink[]> => {
	return getCachedPageLinks(await requestLangOf(event)).catch((error) => {
		logDegraded('page-links', classifyMxError(error))
		return []
	})
})
