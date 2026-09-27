import type { LiveDesk } from '~~/app/types/live'
import { liveDeskFrom, loadLiveDeskState } from '~~/app/utils/mx/companion'

/**
 * core 的公开状态全站缓存 15 秒；映射（播放位置推到此刻、图片换成签好名的转发地址）按每次请求做。
 * 浏览器收到实时推送后带着新的版本号（`?rev=<epoch>:<revision>`）来取：缓存里的比它旧就回源，
 * 同一时间只回源一次，两次回源至少隔 2 秒（版本号由访客随意填，不能拿来刷 core）
 */
const TTL = 15_000
const FORCED_GAP = 2000
let cached: { state: unknown, at: number } | undefined
let inflight: Promise<unknown> | undefined
let forcedAt = 0

function versionOf(state: unknown) {
	const { epoch, revision } = (state ?? {}) as { epoch?: unknown, revision?: unknown }
	return { epoch: typeof epoch === 'string' ? epoch : '', revision: typeof revision === 'number' ? revision : -1 }
}

/** `rev` 比缓存里的新吗：换了 epoch，或同一 epoch 下版本号更大 */
function isNewer(rev: string, state: unknown) {
	const [epoch = '', raw = ''] = rev.split(':')
	const revision = Number(raw)
	if (!epoch || epoch.length > 64 || !Number.isSafeInteger(revision) || revision < 0)
		return false
	const current = versionOf(state)
	return epoch !== current.epoch || revision > current.revision
}

function loadState() {
	inflight ??= loadLiveDeskState(useServerMxClient()).catch(() => null).then((state) => {
		cached = { state, at: Date.now() }
		return state
	}).finally(() => {
		inflight = undefined
	})
	return inflight
}

async function stateFor(rev: string | undefined) {
	const now = Date.now()
	if (!cached || now - cached.at >= TTL)
		return loadState()
	if (rev && isNewer(rev, cached.state) && now - forcedAt >= FORCED_GAP) {
		forcedAt = now
		return loadState()
	}
	return cached.state
}

/** 站长「此刻」：主题配置 `liveDesk.enable` 开了才取；没有时是 null */
export default defineEventHandler(async (event): Promise<LiveDesk | null> => {
	const theme = await getThemeConfigWithTimeZone()
	if (!theme.liveDesk.enable)
		return null
	const rev = getQuery(event).rev
	const state = await stateFor(typeof rev === 'string' ? rev : undefined)
	return liveDeskFrom(state, { showWindowTitle: theme.liveDesk.showWindowTitle, imageUrlOf: liveDeskImageUrlOf })
})
