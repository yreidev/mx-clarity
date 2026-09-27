import type { OwnerStatus } from '~~/app/types/live'
import { ownerStatusFrom } from '~~/app/utils/mx/companion'

/** 站长自己装的云函数（`ref/name`，主题配置校验过格式）；它返回什么原样给什么，不经 api-client 的信封 */
const getCachedOwnerStatus = defineCachedFunction(
	async (fn: string) => {
		const [reference, name] = fn.split('/')
		const raw = await $fetch(`${useRuntimeConfig().mxApiUrl}/fn/${encodeURIComponent(reference!)}/${encodeURIComponent(name!)}`, { timeout: 3000, retry: 0 }).catch(() => undefined)
		return raw === undefined ? null : raw
	},
	{ name: 'mx-owner-status', maxAge: 60, getKey: (fn: string) => fn.replace(/\W/g, '_') },
)

/** 站长状态：主题配置 `ownerStatus.fn` 设了才取，全站缓存 60 秒；过期、没有都是 null */
export default defineEventHandler(async (): Promise<OwnerStatus | null> => {
	const { ownerStatus } = await getThemeConfigWithTimeZone()
	if (!ownerStatus.fn)
		return null
	return ownerStatusFrom(await getCachedOwnerStatus(ownerStatus.fn))
})
