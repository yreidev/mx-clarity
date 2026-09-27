import type { InjectionKey, Ref } from 'vue'
import type { CommentAnchorDraft, CommentHighlight, ReaderState } from '~/types/comment'
import type { CheckoutRequest } from '~/types/membership'

/**
 * 评论区的共享状态、登录与退出。取数与提交在 useCommentApi.ts（浏览器直连 core）；读者登录直接请求同源的 `/api/v3/auth`。
 * 评论区只在浏览器里加载（滚动到附近时），所以这里是普通函数，不用 useAsyncData。
 */

const SIGNED_OUT: ReaderState = { reader: null, providers: [] }
let readerRequest: Promise<ReaderState> | undefined

/**
 * 当前读者（登录身份与可用的登录方式），全站共用一份：评论区、付费墙、会员页都读它，
 * 一处登录或退出后调 `refresh()`，别处跟着变。只在浏览器里取，同时发起的只请求一次；取不到当作没登录。
 * `reader` 在第一次取到之前是 `undefined`
 */
export function useMxReader() {
	const reader = useState<ReaderState | undefined>('mx-reader', () => undefined)
	const core = useCoreClient()
	function refresh(): Promise<ReaderState> {
		if (import.meta.server)
			return Promise.resolve(SIGNED_OUT)
		readerRequest ??= loadReaderState(core)
			.catch(() => SIGNED_OUT)
			.then((state) => {
				reader.value = state
				return state
			})
			.finally(() => {
				readerRequest = undefined
			})
		return readerRequest
	}
	return { reader, refresh }
}

/** 读者身份的指纹：没取到时是 `undefined`，用来判断登录状态有没有变 */
export function readerKeyOf(state: ReaderState | undefined) {
	if (!state)
		return undefined
	return state.reader ? `${state.reader.provider ?? ''}:${state.reader.name}:${state.reader.isOwner}` : 'guest'
}

/** 请求出错时带的提示（本站接口、`callCore` 抛的）都是固定文案，可以直接给读者看 */
export function serverErrorMessage(error: unknown, fallback: string) {
	const message = (error as { data?: { message?: unknown } } | undefined)?.data?.message
	return typeof message === 'string' && message ? message : fallback
}

const HTTPS_URL = /^https:\/\//i

/** 登录是从哪里发起的：评论区回来时滚回评论区；购买的话登录回来接着结账 */
export type LoginFrom = 'comments' | 'purchase'

/** 划词评论：正文里选中、点了「评论这段」的那段，评论框顶上显示、发顶层评论时带上 */
export function useCommentAnchor() {
	return useState<CommentAnchorDraft | undefined>('mx-comment-anchor', () => undefined)
}

/** 「引用评论」：预填进顶层评论框的 `> 选中的文字`（跨块、markdown 文章里的选区，不带锚点） */
export function useCommentQuote() {
	return useState<string | undefined>('mx-comment-quote', () => undefined)
}

/** 正文里带锚点的评论：高亮、段落边栏、讨论弹层共用一份 */
export function useAnchoredComments() {
	return useState<CommentHighlight[]>('mx-anchored-comments', () => [])
}

/** 讨论弹层：哪一段（锚点草稿）、这一段有哪些评论、弹在哪里（视口坐标） */
export interface AnchorPanelState {
	draft: CommentAnchorDraft
	ids: string[]
	x: number
	y: number
}

export function useAnchorPanel() {
	return useState<AnchorPanelState | undefined>('mx-anchor-panel', () => undefined)
}

/** 悬停联动：正文的下划线与评论区里的评论互相标出来 */
export function useHoveredAnchor() {
	return useState<{ blockId: string, quote?: string, ids: string[] } | undefined>('mx-anchor-hover', () => undefined)
}

/** 朗读的块按钮：Tts.vue 取到分段后登记有哪些块、怎么从某一块开始放 */
export function useTtsBlocks() {
	return useState<{ ids: string[], play?: (blockId: string) => void }>('mx-tts-blocks', () => ({ ids: [] }))
}

/** 发起登录前记在 `sessionStorage` 里的去向，15 分钟内有效 */
interface LoginMarker {
	from: LoginFrom
	path: string
	at: number
	/** 登录后要接着买的东西（#67）：只有种类、方案、文章 id */
	intent?: DistributiveOmit<CheckoutRequest, 'returnPath'>
}

const LOGIN_KEY = 'mx-clarity:login'
const LOGIN_TTL = 15 * 60_000

function readLoginMarker(): LoginMarker | undefined {
	try {
		const raw = JSON.parse(sessionStorage.getItem(LOGIN_KEY) ?? 'null') as LoginMarker | null
		return raw && typeof raw === 'object' && typeof raw.at === 'number' && typeof raw.path === 'string' ? raw : undefined
	}
	catch {
		return undefined
	}
}

/**
 * 社交登录（Better Auth）：core 返回服务商的授权地址，跳过去，登录完回到当前页。
 * 授权地址只认 https，免得被带去别的协议。`from` 记下是从哪儿发起的，回来后见 `takeLoginReturn`
 */
export async function signInWith(provider: string, from?: LoginFrom, intent?: LoginMarker['intent']) {
	const { mxAuthUrl } = useRuntimeConfig().public
	const url = new URL(location.href)
	url.hash = ''
	// 上次失败留下的 ?error= 不带回去
	url.searchParams.delete('error')
	const here = url.href
	const res = await $fetch<{ url?: string }>(`${mxAuthUrl}/sign-in/social`, {
		method: 'POST',
		body: { provider, callbackURL: here, errorCallbackURL: here },
	})
	if (!res.url || !HTTPS_URL.test(res.url))
		throw new Error('登录地址不对')
	try {
		if (from)
			sessionStorage.setItem(LOGIN_KEY, JSON.stringify({ from, path: location.pathname, at: Date.now(), intent } satisfies LoginMarker))
	}
	catch {}
	location.href = res.url
}

/**
 * 登录回来（#67、#70）：`from` 与发起时一样、还在同一页、15 分钟内，就取走记下的去向。
 * Better Auth 登录失败时带 `?error=` 回来：只报「失败了」，不回显参数内容，并把参数从地址栏去掉
 */
export function takeLoginReturn(from: LoginFrom): { failed: boolean, intent?: LoginMarker['intent'] } | undefined {
	if (import.meta.server)
		return undefined
	const marker = readLoginMarker()
	if (!marker || marker.from !== from)
		return undefined
	try {
		sessionStorage.removeItem(LOGIN_KEY)
	}
	catch {}
	if (marker.path !== location.pathname || Date.now() - marker.at > LOGIN_TTL)
		return undefined
	const url = new URL(location.href)
	const failed = url.searchParams.has('error')
	if (failed) {
		url.searchParams.delete('error')
		history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
	}
	return { failed, intent: failed ? undefined : marker.intent }
}

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never

/**
 * 注销账号（#72）：浏览器直接同源请求 Better Auth 的 `delete-user`（不经主题转发，Origin 由浏览器带）。
 * 不传密码（社交登录没有密码，传了反而失败）。会话太旧时 Better Auth 回 400 `SESSION_EXPIRED`
 */
export async function deleteAccount(): Promise<'deleted' | 'stale-session' | 'failed'> {
	const { mxAuthUrl } = useRuntimeConfig().public
	try {
		await $fetch(`${mxAuthUrl}/delete-user`, { method: 'POST', body: {} })
		return 'deleted'
	}
	catch (error) {
		const data = (error as { data?: { code?: unknown, message?: unknown } }).data
		return data?.code === 'SESSION_EXPIRED' || data?.message === 'SESSION_EXPIRED' ? 'stale-session' : 'failed'
	}
}

export function signOut() {
	const { mxAuthUrl } = useRuntimeConfig().public
	return $fetch(`${mxAuthUrl}/sign-out`, { method: 'POST', body: {} })
}

/** 登录方式 → 显示名与图标 */
export function providerMeta(provider: string) {
	switch (provider) {
		case 'github':
			return { name: 'GitHub', icon: 'tabler:brand-github' }
		case 'google':
			return { name: 'Google', icon: 'tabler:brand-google' }
		case 'apple':
			return { name: 'Apple', icon: 'tabler:brand-apple' }
		default:
			return { name: provider, icon: 'tabler:login-2' }
	}
}

/** 评论区内共享的状态：谁在看、能不能匿名、正在回复哪一条 */
export interface CommentContext {
	refId: string
	reader: Readonly<Ref<ReaderState>>
	allowGuest: Ref<boolean>
	/** 同一时间只开一个回复框 */
	replyingTo: Ref<string | undefined>
	/** 按 `#comment-<id>` 定位到的那一条，高亮显示 */
	highlighted: Readonly<Ref<string | undefined>>
	refreshReader: () => Promise<void>
	/** 重新加载评论区（置顶、屏蔽之后） */
	reload: () => Promise<void>
}

export const commentContextKey: InjectionKey<CommentContext> = Symbol('mx-comment-context')

export function useCommentContext() {
	const context = inject(commentContextKey)
	if (!context)
		throw new Error('评论组件必须放在 PostComment 里')
	return context
}
