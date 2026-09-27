import { canApplyLink, loadLinkGroups } from '~~/app/utils/mx/pages'

/** 友链（另带被封禁的名称）与申请开关，缓存 10 分钟。开关拿不到时按关闭处理，不影响列表 */
export default defineCachedEventHandler(async () => {
	const client = useServerMxClient()
	try {
		const [{ groups, banned }, canApply] = await Promise.all([
			loadLinkGroups(client),
			canApplyLink(client).catch(() => false),
		])
		return { groups, banned, canApply }
	}
	catch (error) {
		throw toHttpError(error)
	}
}, { name: 'mx-links', maxAge: 600, swr: true, getKey: () => 'all' })
