import type { Ref } from 'vue'
import type { LiveServerMessage } from '~/types/live'
import type { MxClient } from '~/utils/mx/client'
import type { CommentMapOptions } from '~/utils/mx/comments'
import type { RelayState } from '~/utils/mx/live'
import { coreAckOf, coreWsUrlOf, presenceListOf, presenceReportOf, relayCoreFrame, roomFrame } from '~/utils/mx/live'

/**
 * 实时活动：全站一条连接，浏览器直连 core 的 `/ws/web`（同源，由反向代理交给 core），帧由 app/utils/mx/live.ts 认、拆、组装。
 * 断线按指数退避重连（1–30 秒带抖动）；每 25 秒发一次 core 的 `ping`，10 秒收不到确认就当断了。
 * 进房间要等 core 确认（`room.join` 的 ack）才报阅读位置，报位置直接调 core 的 `presence/update`（不带 cookie，同一篇 2 秒最多一次）。
 * 服务端渲染时什么都不做，页面上的数字在浏览器里才出现。
 *
 * 连接由 `app/plugins/mx-live.client.ts` 在水合**之后**建立（`startMxLive`）：数字要是在水合完成前就到了，
 * 页脚、文章头部渲染出的 HTML 会和服务端的不一致（实测整页报 hydration mismatch）。
 * 组件里的 `useMxLive()` 只拿状态，不会提前连。
 */

export interface MxLive {
	/** 当前在线人数；还没连上时为空 */
	online: Ref<number | undefined>
	/** 收到过实时更新的阅读次数，没收到过时为空 */
	readCountOf: (kind: 'post' | 'note', id: string) => number | undefined
	/** 进入某篇内容的房间（「正在阅读」据此统计），同时只在一个 */
	join: (id: string) => void
	leave: (id: string) => void
	/** 报告自己在当前房间读到哪（0–100）；没进房间时不发，重连后自动补报 */
	presence: (position: number, name?: string) => void
	/** 收实时消息（新评论、阅读位置、新文章……）；返回取消订阅的函数 */
	subscribe: (handler: (message: LiveServerMessage) => void) => () => void
}

/** 建立连接时要的东西，由插件从运行时配置、站点与主题配置里取 */
export interface LiveContext {
	/** 浏览器直连 core 的地址（同源的 `/api/v3`）；实时连接在同一主机的 `/ws/web` */
	apiUrl: string
	/** 报阅读位置、取在读列表用的客户端（不带 cookie） */
	core: () => MxClient
	/** 映射新评论用的站点设置 */
	commentOptions: () => CommentMapOptions
	/** 站长的名字：阅读位置里与它同名的写成「匿名」 */
	ownerName: () => string | undefined
}

const SESSION_KEY = 'mx-clarity:live-session'
const IDENTITY_KEY = 'mx-clarity:live-identity'
const PING_INTERVAL = 25_000
const PONG_TIMEOUT = 10_000
/** 阅读位置最多这么久报一次 */
const PRESENCE_INTERVAL = 2000

/**
 * 存在 `sessionStorage` 里的随机串：会话 id 同一会话开多个标签页算一人（core 按它去重）；
 * 阅读位置的标识另起一个，不拿会话 id 当标识（core 会把标识广播给同一篇的读者）。
 * 局域网 http 下没有 crypto.randomUUID，用 getRandomValues
 */
function storedId(key: string) {
	try {
		const saved = sessionStorage.getItem(key)
		if (saved)
			return saved
	}
	catch {}
	const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('')
	try {
		sessionStorage.setItem(key, id)
	}
	catch {}
	return id
}

interface LiveState extends MxLive {
	start: (context: LiveContext) => void
}

function createLive(): LiveState {
	const online = ref<number>()
	const reads = reactive<Record<string, number>>({})
	let context: LiveContext | undefined
	let socket: WebSocket | undefined
	let room: string | undefined
	let retries = 0
	let pingTimer: ReturnType<typeof setInterval> | undefined
	let pongTimer: ReturnType<typeof setTimeout> | undefined
	const listeners = new Set<(message: LiveServerMessage) => void>()
	let connectedBefore = false
	/** 最近一次要报的位置；换房间时清掉 */
	let position: { position: number, name?: string } | undefined
	let presenceSentAt = 0
	let presenceTimer: ReturnType<typeof setTimeout> | undefined
	/** 这次 `room.join` 的信封 id，与 ack 对上才算进了房间 */
	let joinId: string | undefined
	let joins = 0
	let joined = false
	let pings = 0
	let pingId: string | undefined
	let sid = ''
	const state: RelayState = { maskIdentity: identity => identity, liveDeskSignal: true }

	const sendRaw = (frame: string) => {
		if (socket?.readyState === WebSocket.OPEN)
			socket.send(frame)
	}

	function emit(message: LiveServerMessage) {
		switch (message.type) {
			case 'online':
				online.value = message.count
				break
			case 'read':
				reads[`${message.kind}:${message.id}`] = message.count
				break
		}
		for (const handler of listeners) {
			try {
				handler(message)
			}
			catch {}
		}
	}

	function stopTimers() {
		clearInterval(pingTimer)
		clearTimeout(pongTimer)
	}

	function joinRoom() {
		state.room = room
		if (!room)
			return
		joined = false
		joinId = `join-${++joins}`
		sendRaw(roomFrame('room.join', room, joinId))
	}

	function reportPresence() {
		clearTimeout(presenceTimer)
		if (!room || !joined || !position || !context || !state.identity)
			return
		const wait = presenceSentAt + PRESENCE_INTERVAL - Date.now()
		if (wait > 0) {
			presenceTimer = setTimeout(reportPresence, wait)
			return
		}
		presenceSentAt = Date.now()
		const data = presenceReportOf({ identity: state.identity, room, sid, position: position.position, name: position.name, ownerName: context.ownerName() })
		context.core().proxy('activity')('presence')('update').post<unknown>({ data } as never).catch(() => undefined)
	}

	/** 进了房间：补报位置，再取一份这一篇现在的在读列表（带 ts，绕开 core 的 15 秒缓存） */
	function onJoined() {
		joined = true
		reportPresence()
		const current = room
		if (!current || !context)
			return
		context.core().proxy('activity')('presence').get<unknown>({ params: { roomName: `article-${current}`, ts: Date.now() }, transformResponse: false } as never).then((raw) => {
			if (room === current && joined)
				emit(presenceListOf(raw, state))
		}).catch(() => undefined)
	}

	function scheduleReconnect() {
		const delay = Math.min(30_000, 1000 * 2 ** retries) * (0.5 + Math.random() / 2)
		retries++
		setTimeout(open, delay)
	}

	function open() {
		if (!context)
			return
		const ws = new WebSocket(coreWsUrlOf(new URL(context.apiUrl, location.href).href, sid))
		socket = ws
		ws.addEventListener('open', () => {
			// 断线后又连上了：断线期间的推送丢了，告诉要的组件自己重新取一次
			if (connectedBefore)
				emit({ type: 'reconnected' })
			connectedBefore = true
			retries = 0
			presenceSentAt = 0
			joinRoom()
			pingTimer = setInterval(() => {
				pingId = `ping-${++pings}`
				sendRaw(JSON.stringify({ v: 1, event: 'ping', id: pingId }))
				pongTimer = setTimeout(() => ws.close(), PONG_TIMEOUT)
			}, PING_INTERVAL)
		})
		ws.addEventListener('message', (event) => {
			const raw = String(event.data)
			const ack = coreAckOf(raw)
			if (ack) {
				if (ack.id === pingId)
					clearTimeout(pongTimer)
				else if (ack.ok && ack.id === joinId)
					onJoined()
				return
			}
			if (context) {
				state.comments = context.commentOptions()
				state.ownerName = context.ownerName()
			}
			const message = relayCoreFrame(raw, state)
			if (message)
				emit(message)
		})
		ws.addEventListener('close', () => {
			stopTimers()
			if (socket === ws) {
				online.value = undefined
				joined = false
				scheduleReconnect()
			}
		})
	}

	return {
		start(next) {
			if (context)
				return
			context = next
			sid = storedId(SESSION_KEY)
			state.identity = storedId(IDENTITY_KEY)
			open()
		},
		online,
		readCountOf: (kind, id) => reads[`${kind}:${id}`],
		join(id) {
			if (room === id)
				return
			if (room)
				sendRaw(roomFrame('room.leave', room))
			position = undefined
			room = id
			joinRoom()
		},
		leave(id) {
			if (room !== id)
				return
			sendRaw(roomFrame('room.leave', id))
			room = undefined
			state.room = undefined
			joined = false
			position = undefined
			clearTimeout(presenceTimer)
		},
		presence(value, name) {
			const next = { position: Math.round(Math.min(100, Math.max(0, value))), ...(name ? { name: name.slice(0, 20) } : {}) }
			if (position?.position === next.position && position.name === next.name)
				return
			position = next
			reportPresence()
		},
		subscribe(handler) {
			listeners.add(handler)
			return () => listeners.delete(handler)
		},
	}
}

let instance: LiveState | undefined

const idle: MxLive = {
	online: ref(),
	readCountOf: () => undefined,
	join() {},
	leave() {},
	presence() {},
	subscribe: () => () => {},
}

export function useMxLive(): MxLive {
	if (import.meta.server)
		return idle
	instance ??= createLive()
	return instance
}

/** 左下角的提示：新发布、这篇更新了……最多留 3 条，新的在前 */
export interface LiveNoticeItem {
	id: number
	text: string
	/** 带链接的提示（新发布）：点标题去那一篇 */
	link?: { path: string, title: string }
}

let noticeSeq = 0

export function useLiveNotices() {
	const items = useState<LiveNoticeItem[]>('mx-live-notices', () => [])
	return {
		items,
		push(notice: Omit<LiveNoticeItem, 'id'>) {
			const id = ++noticeSeq
			items.value = [{ ...notice, id }, ...items.value].slice(0, 3)
			// 纯文字的提示 8 秒后自己消失；带链接的（新发布）留着等读者看
			if (!notice.link && import.meta.client)
				setTimeout(() => items.value = items.value.filter(item => item.id !== id), 8000)
		},
		clear() {
			items.value = []
		},
	}
}

/**
 * 详情页用：当前这一篇被站长改了就在后台重取（付费墙照常由服务端按读者身份判定）并提示；
 * 被删除或下线就返回 true，页面把正文换成说明
 */
export function useLiveContent(id: MaybeRefOrGetter<string | undefined>, refresh: () => Promise<unknown>) {
	const removed = ref(false)
	const notices = useLiveNotices()
	const t = useT()
	useLiveMessages((message) => {
		if ((message.type !== 'content-updated' && message.type !== 'content-removed') || message.id !== toValue(id))
			return
		if (message.type === 'content-removed') {
			removed.value = true
			return
		}
		refresh().then(() => notices.push({ text: t('site.authorUpdatedPage') }), () => undefined)
	})
	watch(() => toValue(id), () => removed.value = false)
	return removed
}

/** 组件里收实时消息：挂载后订阅，卸载时退订 */
export function useLiveMessages(handler: (message: LiveServerMessage) => void) {
	let off: (() => void) | undefined
	onMounted(() => {
		off = useMxLive().subscribe(handler)
	})
	onBeforeUnmount(() => off?.())
}

/** 建立连接；只该在水合之后调用（见文件头） */
export function startMxLive(context: LiveContext) {
	if (import.meta.server)
		return
	instance ??= createLive()
	instance.start(context)
}

const REPORTED_KEY = 'mx-clarity:read-reported'

/** 同一会话同一篇只报一次（本站另有按 IP 的去重）；报成功了才记下，失败的下次打开还会再报 */
function reportOnce(kind: 'post' | 'note', id: string) {
	const key = `${kind}:${id}`
	const reported = (): string[] => {
		try {
			return JSON.parse(sessionStorage.getItem(REPORTED_KEY) ?? '[]')
		}
		catch {
			return []
		}
	}
	if (reported().includes(key))
		return
	$fetch('/api/mx/read', { method: 'POST', body: { kind, id } }).then(() => {
		try {
			sessionStorage.setItem(REPORTED_KEY, JSON.stringify([...reported().filter(k => k !== key), key].slice(-200)))
		}
		catch {}
	}, () => undefined)
}

/**
 * 详情页用：打开时上报一次阅读、进入「正在阅读」的房间，离开时退出。
 * 独立页没有阅读次数，只进房间。
 * `options.presence` 为 false 时不进房间——解锁进来的加密日记要这样，否则它的标题会出现在「正在阅读」里
 */
export function useArticleActivity(
	kind: 'post' | 'note' | 'page',
	id: MaybeRefOrGetter<string | undefined>,
	options: { presence?: MaybeRefOrGetter<boolean> } = {},
) {
	const live = useMxLive()
	onMounted(() => {
		watch(() => [toValue(id), toValue(options.presence ?? true)] as const, ([current, presence], previous) => {
			const [before] = previous ?? []
			if (before && before !== current)
				live.leave(before)
			if (!current)
				return
			if (kind !== 'page')
				reportOnce(kind, current)
			if (presence)
				live.join(current)
			else
				live.leave(current)
		}, { immediate: true })
	})
	onBeforeUnmount(() => {
		const current = toValue(id)
		if (current)
			live.leave(current)
	})
}
