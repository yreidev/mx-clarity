import type { SubscribeType } from '~/types/subscribe'
import { loadSubscribeStatus } from '~/utils/mx/subscribe'

/**
 * 邮件订阅开没开、开放哪几类：浏览器直连 core 取一次，这次访问里页脚与正文后面共用，换页不再取
 * （两处同时要时后到的等先发的那个，不取消重发）。取不到当作没开
 */
export function useSubscribeStatus() {
	const core = useCoreClient()
	return useLazyAsyncData('mx-subscribe', () => loadSubscribeStatus(core()).catch(() => ({ enable: false, types: [] as SubscribeType[] })), {
		server: false,
		dedupe: 'defer',
		getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key],
	})
}
