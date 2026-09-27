import type { ArticleAccess, CheckoutRequest, MembershipMe, MembershipOffers } from '~/types/membership'
import type { MxClient } from '~/utils/mx/client'
import { msg } from '~~/shared/utils/i18n'
import { checkoutErrorOf, loadArticleAccess, loadMembershipMe, parseCheckoutRequest, startCheckout, UnsafeCheckoutUrlError } from '~/utils/mx/membership'

/**
 * 付费文章与会员的浏览器端：本人的会员状态、单篇权限与结账直连 core，读者身份靠同源 cookie；
 * 方案与价格全站一样，取本站缓存的那份。客户端由组件传进来（`useCoreClient()`）。
 * 浏览器看不到登录 cookie（HttpOnly），一律当作可能登录了去问：没登录时 core 回未登录，按「不是会员、没买过」处理
 */

export function fetchMembershipOffers() {
	return $fetch<MembershipOffers>('/api/mx/membership/plans')
}

export function fetchMembershipMe(core: () => MxClient): Promise<MembershipMe> {
	return loadMembershipMe(core(), true)
}

/** 限时公开期间：本人是会员或买过这篇的话，到期后照常能读 */
export function fetchArticleAccess(core: () => MxClient, postId: string): Promise<ArticleAccess> {
	return loadArticleAccess(core(), postId, true)
}

const RETURN_PARAMS = ['membership', 'purchase']

/** 当前页面的站内地址，去掉支付回来时 core 附上的参数，当作付完的返回地址 */
function currentReturnPath() {
	const url = new URL(location.href)
	for (const name of RETURN_PARAMS)
		url.searchParams.delete(name)
	return `${url.pathname}${url.search}`
}

const HTTPS_URL = /^https:\/\//i

/** 发起支付，拿到支付平台的收银台地址后整页跳过去；地址只认 https */
export async function startMembershipCheckout(core: () => MxClient, request: DistributiveOmit<CheckoutRequest, 'returnPath'>) {
	const parsed = parseCheckoutRequest({ ...request, returnPath: currentReturnPath() })
	if (typeof parsed === 'string')
		refuse(400, parsed)
	const { checkoutUrl } = await callCore(() => startCheckout(core(), parsed).catch((error) => {
		if (error instanceof UnsafeCheckoutUrlError)
			refuse(502, msg('membership.paymentsTemporarilyUnavailable'))
		throw error
	}), checkoutErrorOf)
	if (!HTTPS_URL.test(checkoutUrl))
		throw new Error('支付地址不对')
	location.href = checkoutUrl
}

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

/**
 * 服务端渲染与水合用同一个「现在」：「剩 X 天」之类的文字两边算出来一样，不会水合不一致。
 * 水合完成后由 `plugins/render-now.client.ts` 每分钟往前走一格
 */
export function useRenderNow() {
	return useState('mx-render-now', () => Date.now())
}

/** 「现在」走过 `until` 时调一次 `refresh`（限时公开到期：让 core 重新判定能不能读）；同一个时刻只调一次，只在浏览器里 */
export function useRefreshWhenPassed(until: () => string | undefined, refresh: () => unknown) {
	const now = useRenderNow()
	let done: string | undefined
	watch(now, (value) => {
		const at = until()
		if (at && at !== done && Date.parse(at) <= value) {
			done = at
			refresh()
		}
	})
}

export type PaymentReturnState = 'idle' | 'confirming' | 'unlocked' | 'timeout'

const POLL_INTERVAL = 2000
const POLL_TIMES = 10

/**
 * 付完回来（网址带 `?membership=success` 或 `?purchase=success`）：到账靠支付平台回调 core，可能比读者回来得晚，
 * 所以每 2 秒重取一次文章，最多 10 次；解锁了或到时了都把网址里的参数去掉
 */
export function usePaymentReturn(options: { locked: () => boolean, refresh: () => Promise<unknown> }) {
	const route = useRoute()
	const router = useRouter()
	const state = ref<PaymentReturnState>('idle')
	let unmounted = false

	function stripQuery() {
		const query = { ...route.query }
		for (const name of RETURN_PARAMS)
			delete query[name]
		router.replace({ query, hash: route.hash })
	}

	onMounted(async () => {
		if (!RETURN_PARAMS.some(name => route.query[name] === 'success'))
			return
		if (!options.locked()) {
			state.value = 'unlocked'
			stripQuery()
			return
		}
		state.value = 'confirming'
		for (let i = 0; i < POLL_TIMES; i++) {
			await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL))
			// 等的时候读者离开了这一页
			if (unmounted)
				return
			await options.refresh().catch(() => undefined)
			if (!options.locked()) {
				state.value = 'unlocked'
				stripQuery()
				return
			}
		}
		state.value = 'timeout'
		stripQuery()
	})
	onBeforeUnmount(() => {
		unmounted = true
	})
	return state
}

/** 会员页的方案与价格：全站一样，服务端渲染 */
export function useMxMembershipOffers() {
	const fetcher = useRequestFetch()
	return useAsyncData('mx-membership-offers', () => fetcher<MembershipOffers>('/api/mx/membership/plans'))
}
