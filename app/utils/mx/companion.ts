/**
 * 站长「此刻」（Companion 的 Live Desk）与站长状态。纯模块：「此刻」由服务端取好（图片要经本站转发），站长状态在浏览器里直连 core 读写。
 *
 * Live Desk 的状态里有应用名、窗口标题、在放的歌，还有任意 https 的图标与封面地址：
 * 窗口标题隐私敏感，主题配置另外打开才给；图片（应用图标、封面）是任意第三方地址，直接给读者等于追踪像素，
 * 只给经主题服务器转发、签好名的本站地址。过期或空闲就当作没有
 */
import type { LiveDesk, OwnerStatus } from '../../types/live'
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { msg } from '~~/shared/utils/i18n'
import { plainOf } from './rich-blocks'

const MEDIA_KINDS = new Set(['music', 'podcast', 'video', 'unknown'])

function objectOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export interface LiveDeskOptions {
	showWindowTitle?: boolean
	/** 第三方图片地址 → 经主题服务器转发的本站地址（签好名的）；不给就不带图片 */
	imageUrlOf?: (url: string) => string | undefined
}

/** 在 QQ 音乐、网易云里打开这首歌：只认 core 也认的两种规范地址 */
export function mediaLinkOf(value: unknown) {
	if (typeof value !== 'string' || value.length > 300)
		return undefined
	try {
		const url = new URL(value)
		if (url.protocol !== 'https:' || url.port || url.hash || url.username || url.password)
			return undefined
		if (url.hostname === 'y.qq.com')
			return !url.search && /^\/n\/ryqq\/songDetail\/[\dA-Z]{14}$/i.test(url.pathname) ? url.href : undefined
		if (url.hostname === 'music.163.com') {
			const params = [...url.searchParams.entries()]
			return url.pathname === '/song' && params.length === 1 && params[0]![0] === 'id' && /^(?!0$)\d{1,20}$/.test(params[0]![1]) ? url.href : undefined
		}
	}
	catch {}
	return undefined
}

const safeInt = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)

/** 播放位置推到「此刻」：`positionMs + (现在 − anchorAt) × rate`，夹在 0 到时长之间 */
function playbackOf(playback: Record<string, unknown> | undefined, now: number) {
	const durationMs = safeInt(playback?.durationMs)
	const position = safeInt(playback?.positionMs)
	const rate = typeof playback?.rate === 'number' && playback.rate >= 0 && playback.rate <= 4 ? playback.rate : 0
	if (position === undefined)
		return durationMs ? { durationMs, rate } : {}
	const anchorAt = typeof playback?.anchorAt === 'string' ? Date.parse(playback.anchorAt) : Number.NaN
	const elapsed = Number.isFinite(anchorAt) ? Math.max(0, now - anchorAt) * rate : 0
	const positionMs = Math.round(Math.min(durationMs ?? Number.POSITIVE_INFINITY, position + elapsed))
	return { positionMs, ...(durationMs ? { durationMs } : {}), rate }
}

export function liveDeskFrom(state: unknown, options: LiveDeskOptions = {}, now = Date.now()): LiveDesk | null {
	const data = objectOf(state)
	const projection = objectOf(data?.projection)
	if (!data || !projection || projection.availability !== 'active')
		return null
	const expiresAt = typeof projection.expiresAt === 'string' ? Date.parse(projection.expiresAt) : Number.NaN
	if (Number.isFinite(expiresAt) && expiresAt <= now)
		return null
	const application = objectOf(projection.application)
	const media = objectOf(projection.media)
	const image = (value: unknown) => {
		const url = objectOf(value)?.url
		return typeof url === 'string' ? options.imageUrlOf?.(url) : undefined
	}
	const desk: LiveDesk = {
		epoch: typeof data.epoch === 'string' ? data.epoch.slice(0, 64) : '',
		revision: typeof data.revision === 'number' && Number.isInteger(data.revision) && data.revision >= 0 ? data.revision : 0,
		expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : undefined,
	}
	const appName = plainOf(application?.displayName, 60)
	if (appName) {
		desk.app = { name: appName }
		const label = plainOf(objectOf(application?.activity)?.customLabel, 40)
		if (label)
			desk.app.label = label
		const window = plainOf(objectOf(application?.window)?.title, 120)
		if (options.showWindowTitle && window)
			desk.app.window = window
		const icon = image(application?.icon)
		if (icon)
			desk.app.icon = icon
	}
	const title = plainOf(media?.title, 120)
	const artist = plainOf(media?.artist, 80)
	if (media && (title || artist)) {
		const playback = objectOf(media.playback)
		desk.media = {
			kind: MEDIA_KINDS.has(media.kind as string) ? media.kind as NonNullable<LiveDesk['media']>['kind'] : 'unknown',
			title,
			artist,
			playing: playback?.state === 'playing',
			...playbackOf(playback, now),
		}
		const album = plainOf(media.album, 80)
		if (album)
			desk.media.album = album
		const artwork = image(media.artwork)
		if (artwork)
			desk.media.artwork = artwork
		const link = mediaLinkOf(objectOf(media.link)?.url)
		if (link)
			desk.media.link = link
	}
	return desk.app || desk.media ? desk : null
}

/** core 的公开状态（`state`）原样取回；映射放在下发时做（播放位置要按下发那一刻推算） */
export async function loadLiveDeskState(client: MxClient) {
	const raw = await client.companion.getPublicPresence() as unknown
	return objectOf(raw)?.state ?? raw
}

/** 设置站长状态的请求体（照 Shiro、Yohaku 的 `shiro/status`）：表情 8 字内、一句话 60 字内、有效期 60 秒到 30 天（秒） */
export function parseOwnerStatusInput(body: unknown): { emoji: string, desc: string, ttl: number } | string {
	const input = objectOf(body) ?? {}
	const emoji = plainOf(input.emoji, 8)
	const desc = plainOf(input.desc, 60)
	const ttl = input.ttl
	if (!emoji)
		return msg('site.pickEmoji')
	if (!desc)
		return msg('site.writeStatusMessage')
	if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 60 || ttl > 30 * 86_400)
		return msg('site.durationMustBetween')
	return { emoji, desc, ttl }
}

/**
 * 站长设置或清除状态：主题配置 `ownerStatus.fn` 指的云函数（如 `shiro/status`），POST 设置、DELETE 清除，要站长会话。
 * `fn` 已由主题配置校验过格式（`引用/名称`）
 */
export async function writeOwnerStatus(client: MxClient, fn: string, input?: { emoji: string, desc: string, ttl: number }) {
	const [reference, name] = fn.split('/') as [string, string]
	const endpoint = client.proxy('fn')(reference)(name)
	await (input ? endpoint.post({ data: input }) : endpoint.delete())
}

export function ownerStatusErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	return failure.kind === 'not-found'
		? { statusCode: 404, message: msg('site.ownerStatusCloud') }
		: { statusCode: failure.kind === 'unauthorized' ? 403 : 503, message: msg('site.couldntUpdateStatus') }
}

/** 直接问一次站长状态云函数（带 `ts` 绕过 core 的缓存）：站长刚改完状态时用，取不到是 null */
export async function loadOwnerStatus(client: MxClient, fn: string) {
	const [reference, name] = fn.split('/') as [string, string]
	return ownerStatusFrom(await client.proxy('fn')(reference)(name).get<unknown>({ params: { ts: Date.now() } }).catch(() => null))
}

/** 站长状态云函数的返回（`{ emoji, desc, untilAt }` 或包在 data 里）；过期、没有都是 null */
export function ownerStatusFrom(raw: unknown, now = Date.now()): OwnerStatus | null {
	const data = objectOf(objectOf(raw)?.data) ?? objectOf(raw)
	if (!data)
		return null
	const emoji = plainOf(data.emoji, 8)
	const desc = plainOf(data.desc, 60)
	const until = typeof data.untilAt === 'number' && Number.isFinite(data.untilAt) ? data.untilAt : undefined
	// untilAt 可能是秒也可能是毫秒
	const untilMs = until === undefined ? undefined : until < 1e12 ? until * 1000 : until
	if ((!emoji && !desc) || (untilMs !== undefined && untilMs <= now))
		return null
	return { emoji, desc, untilAt: untilMs ? new Date(untilMs).toISOString() : undefined }
}
