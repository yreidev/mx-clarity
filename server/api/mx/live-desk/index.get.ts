import type { LiveDesk } from '~~/app/types/live'
import { createLiveDeskSource, liveDeskFrom, loadLiveDeskState } from '~~/app/utils/mx/companion'

/**
 * core 的公开状态全站缓存 15 秒；映射（播放位置推到此刻、图片换成签好名的转发地址）按每次请求做。
 * 浏览器收到实时推送后带着新的版本号（`?rev=<epoch>:<revision>`）来取，缓存里的比它旧就回源（规则见 `createLiveDeskSource`）
 */
const stateFor = createLiveDeskSource({ load: () => loadLiveDeskState(useServerMxClient()) })

/** 站长「此刻」：主题配置 `liveDesk.enable` 开了才取；没有时是 null */
export default defineEventHandler(async (event): Promise<LiveDesk | null> => {
	const theme = await getThemeConfigWithTimeZone()
	if (!theme.liveDesk.enable)
		return null
	const rev = getQuery(event).rev
	const state = await stateFor(typeof rev === 'string' ? rev : undefined)
	return liveDeskFrom(state, { showWindowTitle: theme.liveDesk.showWindowTitle, imageUrlOf: liveDeskImageUrlOf })
})
