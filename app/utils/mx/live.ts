/**
 * 实时活动的协议处理：浏览器直连 core 的 `/ws/web`（app/composables/useMxLive.ts），帧在这里认、拆、重新组装成主题自己的消息。
 * 纯模块。先按帧头认事件名，只认下面列出的几个，只取页面要用的字段。
 *
 * 注意 core 本身会把 `comment.create`（带评论者明文邮箱，回复还带 IP 与 UA）、各读者阅读位置的会话 id 推给所有访客，
 * 浏览器直连时读者拿得到这些原始帧。
 */
import type { LiveServerMessage } from '../../types/live'
import type { CommentMapOptions } from './comments'
import type { LiveDeskOptions } from './companion'
import { renderCommentBody } from './comment-body'
import { commentFromModel } from './comments'
import { liveDeskFrom } from './companion'
import { plainOf } from './rich-blocks'

/** core 发来的单条帧上限；超过的不解析（文章更新会推整篇内容，本来也用不到） */
export const CORE_FRAME_MAX = 64 * 1024

const SNOWFLAKE = /^\d{1,20}$/

/** core 的 WebSocket 不在 `/api/v3` 下；http(s) 换成 ws(s) */
export function coreWsUrlOf(apiUrl: string, sessionId: string) {
	const base = apiUrl.replace(/\/+$/, '').replace(/\/api\/v\d+$/, '').replace(/^http/i, 'ws')
	return `${base}/ws/web?${new URLSearchParams({ socket_session_id: sessionId, lang: 'zh' })}`
}

function nonNegativeInt(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

const EVENT_NAME = /^\{"v":1,"event":"([\w.-]{1,64})"/
/** 发布类事件：只下发一个信号，帧不解析（整篇内容，加密日记也带全文） */
const PUBLISH_EVENTS = new Set(['post.create', 'post.republish', 'note.create', 'note.republish'])
/** 这一篇被改了：payload 是整篇（付费的只有公开部分），不解析，只从帧头认 id */
const UPDATE_EVENTS = new Set(['post.update', 'note.update', 'page.update'])
/** 这一篇被删除或下线：payload 就是 id 字符串 */
const REMOVE_EVENTS = new Set(['post.delete', 'post.unpublish', 'note.delete', 'note.unpublish', 'page.delete'])
const RELAYED_EVENTS = new Set([
	...PUBLISH_EVENTS,
	...UPDATE_EVENTS,
	...REMOVE_EVENTS,
	'comment.update',
	'visitor.online',
	'visitor.offline',
	'article.read_count_update',
	'comment.create',
	'comment.delete',
	'activity.update_presence',
	'activity.leave_presence',
	'translation.create',
	'translation.update',
	'companion_presence.changed',
])
const LANG = /^[a-z]{2,3}(?:-[\da-z]{2,8})?$/i
/** core 的评论状态：垃圾评论（`CommentState.Junk`） */
const JUNK = 2

/** 帧开头的事件名：core 的信封是 `JSON.stringify({ v, event, payload, id })`，键的顺序固定，不用解析整帧 */
export function coreEventOf(raw: string) {
	return EVENT_NAME.exec(raw)?.[1]
}

/** 一条实时连接上要记的东西，`relayCoreFrame` 读它（Live Desk 的版本会写回） */
export interface RelayState {
	/** 当前所在的房间（内容 id） */
	room?: string
	/** 这条连接报给 core 的 presence identity（自己的更新不回传） */
	identity?: string
	/** core 里的 identity → 页面上用的标识（浏览器里原样用）；不给就不映射阅读位置 */
	maskIdentity?: (identity: string) => string
	/** 站长的名字：阅读位置里与它同名的写成「匿名」 */
	ownerName?: string
	/** 评论的映射选项；不给就不转新评论 */
	comments?: CommentMapOptions
	/** 主题配置开了 `liveDesk.enable` 才有：就地映射成「此刻」（服务端能给图片签名时用） */
	liveDesk?: LiveDeskOptions
	/** 浏览器里：「此刻」只当作变化信号（版本号），映射与图片签名交给本站的 `/api/mx/live-desk` */
	liveDeskSignal?: boolean
	/** 上一次下发的 Live Desk 版本（core 会重放同一个状态） */
	desk?: { epoch: string, revision: number }
	/** 单测注入的时钟 */
	now?: () => number
}

function objectOf(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const snowflakeOf = (value: unknown) => (typeof value === 'string' && SNOWFLAKE.test(value) ? value : undefined)

/** 阅读位置里显示的名字：纯文本 20 字内；空的、与站长同名的都是「匿名」 */
export function presenceNameOf(value: unknown, ownerName?: string) {
	const name = plainOf(value, 20)
	return !name || (ownerName && name.toLowerCase() === ownerName.trim().toLowerCase()) ? '匿名' : name
}

/** core 的一条 presence → 下发给浏览器的；自己的、不在当前房间的丢掉。`sid`、读者信息、头像、时间一概不转 */
export function presenceItemOf(raw: unknown, state: RelayState): { identity: string, position: number, name: string } | undefined {
	const item = objectOf(raw)
	if (!state.room || !state.maskIdentity || item.roomName !== `article-${state.room}`)
		return undefined
	const identity = typeof item.identity === 'string' && item.identity && item.identity.length <= 200 ? item.identity.toLowerCase() : undefined
	if (!identity || identity === state.identity)
		return undefined
	const position = typeof item.position === 'number' && Number.isFinite(item.position) ? Math.round(Math.min(100, Math.max(0, item.position))) : 0
	return { identity: state.maskIdentity(identity), position, name: presenceNameOf(item.displayName, state.ownerName) }
}

/** `GET /activity/presence` 的返回 → 初始列表（最多 100 人） */
export function presenceListOf(raw: unknown, state: RelayState): LiveServerMessage {
	const items = Object.values(objectOf(objectOf(raw).presence)).slice(0, 100).map(item => presenceItemOf(item, state)).filter(item => item !== undefined)
	return { type: 'presence-list', items }
}

/** 译文更新：payload 带整篇译文，只从帧头取 `refId` 与 `lang`（JSON 字符串里的引号是转义过的，匹配不到值里去） */
function translationOf(raw: string, state: RelayState): LiveServerMessage | undefined {
	const head = raw.slice(0, 2048)
	const refId = /"refId":"(\d{1,20})"/.exec(head)?.[1]
	const lang = /"lang":"([^"]{1,16})"/.exec(head)?.[1]
	return refId && refId === state.room && lang && LANG.test(lang) ? { type: 'translation', refId, lang: lang.toLowerCase() } : undefined
}

/** 当前房间的新评论：悄悄话、垃圾评论、已删除的不转；邮箱、IP、UA、归属地、读者 id 不下发 */
function commentOf(payload: Record<string, unknown>, state: RelayState): LiveServerMessage | undefined {
	if (!state.room || !state.comments || payload.refId !== state.room || payload.isWhispers === true || payload.isDeleted === true || payload.state === JUNK)
		return undefined
	const id = snowflakeOf(payload.id)
	if (!id || typeof payload.createdAt !== 'string')
		return undefined
	const { agent: _agent, location: _location, source: _source, ...comment } = commentFromModel(payload as unknown as Parameters<typeof commentFromModel>[0], state.comments)
	const rootId = snowflakeOf(payload.rootCommentId)
	return rootId && rootId !== id ? { type: 'comment', comment, rootId } : { type: 'comment', comment }
}

function liveDeskOf(payload: Record<string, unknown>, state: RelayState): LiveServerMessage | undefined {
	if (!state.liveDesk && !state.liveDeskSignal)
		return undefined
	const epoch = typeof payload.epoch === 'string' ? payload.epoch.slice(0, 64) : ''
	const revision = nonNegativeInt(payload.revision) ?? 0
	if (state.desk && state.desk.epoch === epoch && revision <= state.desk.revision)
		return undefined
	state.desk = { epoch, revision }
	return state.liveDesk
		? { type: 'live-desk', desk: liveDeskFrom(payload, state.liveDesk) }
		: { type: 'live-desk-changed', epoch, revision }
}

/**
 * core → 浏览器：先按帧头的事件名过白名单（不在里面的不解析），再只取需要的字段重新组装。
 * 其余返回 undefined（丢弃）
 */
export function relayCoreFrame(raw: string, state: RelayState = {}): LiveServerMessage | undefined {
	const event = coreEventOf(raw)
	if (!event || !RELAYED_EVENTS.has(event))
		return undefined
	if (PUBLISH_EVENTS.has(event))
		return { type: 'published' }
	if (UPDATE_EVENTS.has(event)) {
		// core 的文档第一个字段就是 id（`mapBase`）；键的顺序不对时认不出，按丢弃处理
		const room = state.room
		return room && raw.slice(0, 512).includes(`"payload":{"id":"${room}"`) ? { type: 'content-updated', id: room } : undefined
	}
	if (event === 'translation.create' || event === 'translation.update')
		return translationOf(raw, state)
	if (raw.length > CORE_FRAME_MAX)
		return undefined
	let frame: { payload?: unknown }
	try {
		frame = JSON.parse(raw)
	}
	catch {
		return undefined
	}
	if (REMOVE_EVENTS.has(event)) {
		const id = snowflakeOf(frame?.payload)
		return id && id === state.room ? { type: 'content-removed', id } : undefined
	}
	const payload = objectOf(frame?.payload)
	switch (event) {
		case 'visitor.online':
		case 'visitor.offline': {
			const count = nonNegativeInt(payload.online)
			return count === undefined ? undefined : { type: 'online', count }
		}
		case 'article.read_count_update': {
			const count = nonNegativeInt(payload.count)
			const id = snowflakeOf(payload.id)
			const kind = payload.type === 'post' || payload.type === 'note' ? payload.type : undefined
			return count === undefined || !id || !kind ? undefined : { type: 'read', kind, id, count }
		}
		case 'comment.create':
			return commentOf(payload, state)
		case 'comment.delete': {
			const id = snowflakeOf(payload.id)
			return id ? { type: 'comment-delete', id } : undefined
		}
		case 'comment.update': {
			// 访客收到的只有 { id, text }（悄悄话与举报的只推站长）；正文照评论的白名单重新渲染
			const id = snowflakeOf(payload.id)
			if (!id || typeof payload.text !== 'string' || payload.text.length > 2000 || !state.comments)
				return undefined
			return { type: 'comment-edit', id, body: renderCommentBody(payload.text, { imagePrefixes: state.comments.imagePrefixes }), editedAt: new Date(state.now?.() ?? Date.now()).toISOString() }
		}
		case 'activity.update_presence': {
			const item = presenceItemOf(payload, state)
			return item && { type: 'presence', ...item }
		}
		case 'activity.leave_presence': {
			// 离开只带 identity 与房间名；自己的也不回传
			const item = presenceItemOf({ ...payload, position: 0 }, state)
			return item && { type: 'presence-leave', identity: item.identity }
		}
		case 'companion_presence.changed':
			return liveDeskOf(payload, state)
		default:
			return undefined
	}
}

/** core 对带 id 的入站消息回的确认：`{ v, event: 'ack', payload: { ok }, id }` */
export function coreAckOf(raw: string): { id: string, ok: boolean } | undefined {
	if (coreEventOf(raw) !== 'ack' || raw.length > 1024)
		return undefined
	try {
		const frame = JSON.parse(raw) as { id?: unknown, payload?: unknown }
		return typeof frame.id === 'string' ? { id: frame.id, ok: objectOf(frame.payload).ok === true } : undefined
	}
	catch {
		return undefined
	}
}

/** 发给 core 的帧；房间名是 core 的约定 `article-<id>`（`activity.util.ts`）。带 `envelopeId` 时 core 会回 ack */
export function roomFrame(event: 'room.join' | 'room.leave', id: string, envelopeId?: string) {
	return JSON.stringify({ v: 1, event, payload: { room: `article-${id}` }, ...(envelopeId ? { id: envelopeId } : {}) })
}

/** `POST /activity/presence/update` 的请求体。昵称是空的、与站长同名的都不带（显示成匿名） */
export function presenceReportOf(input: { identity: string, room: string, sid: string, position: number, name?: string, ownerName?: string, now?: number }) {
	const name = presenceNameOf(input.name, input.ownerName)
	return {
		identity: input.identity,
		roomName: `article-${input.room}`,
		sid: input.sid,
		position: input.position,
		ts: input.now ?? Date.now(),
		...(name === '匿名' ? {} : { displayName: name }),
	}
}

/**
 * 带过期时间的「见过没有」集合，阅读量上报的服务端去重用。
 * 超过 `maxSize` 时先清过期的，还满就丢最早的
 */
export function createTtlSet(ttlMs: number, maxSize: number, now: () => number = Date.now) {
	const expires = new Map<string, number>()
	return {
		/** 没见过（或已过期）时记下并返回 true */
		add(key: string) {
			const t = now()
			const until = expires.get(key)
			if (until !== undefined && until > t)
				return false
			expires.delete(key)
			if (expires.size >= maxSize) {
				for (const [k, v] of expires) {
					if (v <= t)
						expires.delete(k)
				}
				if (expires.size >= maxSize)
					expires.delete(expires.keys().next().value!)
			}
			expires.set(key, t + ttlMs)
			return true
		},
		/** 撤销一次 `add`（事情没办成，下次还要算） */
		delete(key: string) {
			expires.delete(key)
		},
		get size() {
			return expires.size
		},
	}
}
