import type { MembershipOffers } from '~~/app/types/membership'
import { classifyMxError } from '~~/app/utils/mx/errors'
import { loadOffers } from '~~/app/utils/mx/membership'

/** 方案与价格全站一样，缓存 10 分钟（core 向支付平台查价也缓存 10 分钟） */
const getCachedOffers = defineCachedFunction(
	() => loadOffers(useServerMxClient()),
	{ name: 'mx-membership-offers', maxAge: 600, swr: true, getKey: () => 'default' },
)

const DISABLED: MembershipOffers = { enabled: false, plans: [], article: { enabled: false }, appleIap: { enabled: false } }

/** 上次取失败的时刻：失败不进缓存，而页脚每次渲染都要问一次，失败后 60 秒内直接当作没开放，不再打 core */
let failedAt = 0

/** 会员方案与单篇解锁。取不到时当作没开放：付费墙照样显示，只是没有购买按钮 */
export default defineEventHandler(async (): Promise<MembershipOffers> => {
	// 仍当作 core 失败：这段时间渲染的页面没有购买按钮，不能进整页缓存
	if (Date.now() - failedAt < 60_000) {
		noteCoreFailure({ kind: 'unavailable' })
		return DISABLED
	}
	return getCachedOffers().catch((error) => {
		failedAt = Date.now()
		logDegraded('membership-plans', classifyMxError(error))
		return DISABLED
	})
})
