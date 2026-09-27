/**
 * 评论的取数、映射与提交。纯模块，浏览器直连 core 时用（app/composables/useCommentApi.ts）。
 *
 * 映射只挑页面要用的字段，`agent` 只留解析好的「浏览器 · 系统」。
 * 注意 core 的公开评论接口本身就带着评论者的 `ip`、`agent` 和读者邮箱，浏览器直连时读者看得到原始返回。
 */
import type { CommentModel } from '@mx-space/api-client'
import type { CommentDraft, CommentEditResult, CommentHighlight, CommentIdentity, CommentLocateResult, CommentPage, CommentProps, CommentSort, CommentSubmitResult, CommentSubmitStatus, CommentThread, CommentThreadBatch, MyComment, MyCommentPage, MyCommentStatus, ReaderSession } from '../../types/comment'
import type { AnchorBlock, CoreBlockAnchor, CoreRangeAnchor } from './anchor'
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { agentLabelOf } from '~~/shared/utils/agent'
import { isEditableAt } from '~~/shared/utils/comment'
import { msg } from '~~/shared/utils/i18n'
import { safeUrl } from './adapter'
import { anchorHighlightOf, commentAnchorOf, parseAnchorInput } from './anchor'
import { commentExcerptOf, renderCommentBody } from './comment-body'
import { classifyMxError } from './errors'
import { paged } from './notes'
import { isMailAddress, objectField, stringField } from './validate'

export const COMMENT_PAGE_SIZE = 10

const SORTS = new Set<CommentSort>(['pinned', 'newest', 'oldest'])

/** 列表排序只认三种，其余按 core 的默认（置顶在前） */
export function commentSortOf(value: unknown): CommentSort {
	return SORTS.has(value as CommentSort) ? value as CommentSort : 'pinned'
}

/** 映射用到的字段。`isOwnerReply` 与每条顶层评论自带的 `reader` 是实测有、api-client 类型里没有的 */
type RawComment = Pick<CommentModel, 'id' | 'author' | 'avatar' | 'url' | 'text' | 'createdAt' | 'pin' | 'readerId' | 'authProvider' | 'parentCommentId' | 'rootCommentId' | 'isWhispers'> & {
	agent?: string | null
	isOwnerReply?: boolean
	reader?: { role?: string | null, isMember?: boolean | null } | null
	editedAt?: string | null
	location?: string | null
	countryCode?: string | null
	anchor?: unknown
}

type RawThread = RawComment & {
	replies?: RawComment[]
	replyWindow?: { hasHidden?: boolean, hiddenCount?: number, nextCursor?: string | null }
}

const HTTPS_URL = /^https:\/\//i

/** 头像只收 https：页面是 https 时 http 图片会被拦，也不该让评论者借头像降级连接 */
function httpsUrl(url: unknown) {
	return typeof url === 'string' && HTTPS_URL.test(url) ? url : undefined
}

/**
 * 评论头像只认这些头像服务（含子域名）。core 的游客评论接口收任意 https 的头像地址，
 * 有人绕过主题直接调 core，就能把头像指到自己的服务器，让每个看评论区的读者都去请求它（等于追踪像素）。
 * cravatar.cn 会跳到 cn.cravatar.com；QQ 头像（qlogo.cn）不认：地址里是明文 QQ 号
 */
const AVATAR_HOSTS = ['cravatar.cn', 'cravatar.com', 'weavatar.com', 'gravatar.com', 'avatars.githubusercontent.com', 'googleusercontent.com']

/** 映射评论时要看的站点设置 */
export interface CommentMapOptions {
	/** 站点自己与站长头像所在的域名，头像额外放行（上传到 core 的头像在那里） */
	avatarHosts?: readonly string[]
	/** 主题配置 `comments.showAgent`：显示「浏览器 · 系统」 */
	showAgent?: boolean
	/** 评论图片在页面上显示的地址前缀（站点自己的存储），见 `CommentBodyOptions` */
	imagePrefixes?: readonly string[]
	/** 读者 id → 不透明标识（服务端的 HMAC）；不给就不带 `authorTag` */
	tagOf?: (readerId: string) => string
	/** 判断「还在可编辑时间内」用的此刻，默认 `Date.now()` */
	now?: number
	/** 这篇的正文块（匿名取的），划词评论的引用按它核对；不给就不显示引用 */
	anchorBlocks?: Record<string, AnchorBlock>
}

/** 可信的头像地址；`extraHosts` 是站点自己与站长头像所在的域名（上传到 core 的头像在那里） */
export function trustedAvatarOf(url: unknown, extraHosts: readonly string[] = []) {
	const href = httpsUrl(url)
	if (!href)
		return undefined
	let host: string
	try {
		host = new URL(href).hostname.toLowerCase()
	}
	catch {
		return undefined
	}
	const allowed = [...AVATAR_HOSTS, ...extraHosts].map(item => item.toLowerCase())
	return allowed.some(item => host === item || host.endsWith(`.${item}`)) ? href : undefined
}

const PROVIDER = /^[a-z][\w-]{0,31}$/

/** 社交登录方式的名字；邮箱密码登录（`credential`）不算 */
function providerOf(value: unknown) {
	return typeof value === 'string' && PROVIDER.test(value) && value !== 'credential' ? value : undefined
}

function identityOf(comment: RawComment): CommentIdentity {
	if (comment.isOwnerReply || comment.reader?.role === 'owner')
		return 'owner'
	return comment.readerId ? 'reader' : 'guest'
}

const CONTROL = /[\p{Cc}\p{Cf}]/gu
const HAN = /\p{Script=Han}/u
const COUNTRY = /^[A-Z]{2}$/

/**
 * IP 归属地 → 显示用的地名。core 只在站长开着「公开显示归属地」时给游客评论写 `location`，所以只认它在不在；
 * 含中文的（迁移来的属地）原样显示；新写的是英文地名直接拼起来的（`ChinaGuangdongShenzhen`），有国家码时换成中文国名
 */
export function locationLabelOf(location: unknown, countryCode?: unknown) {
	const text = typeof location === 'string' ? location.replace(CONTROL, '').trim() : ''
	if (!text)
		return undefined
	if (HAN.test(text))
		return text.slice(0, 20)
	if (typeof countryCode === 'string' && COUNTRY.test(countryCode)) {
		try {
			const name = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(countryCode)
			if (name && name !== countryCode)
				return name
		}
		catch {}
	}
	return text.slice(0, 40)
}

export function commentFromModel(comment: RawComment, options: CommentMapOptions = {}): CommentProps {
	const identity = identityOf(comment)
	const authorTag = identity === 'reader' && comment.readerId && options.tagOf ? options.tagOf(comment.readerId) : undefined
	return {
		id: comment.id,
		author: comment.author?.trim() || msg('common.anonymous'),
		avatar: trustedAvatarOf(comment.avatar, options.avatarHosts),
		// 只下发解析好的「浏览器 · 系统」，UA 原文不往外传
		agent: options.showAgent ? agentLabelOf(comment.agent) : undefined,
		url: safeUrl(comment.url),
		body: renderCommentBody(comment.text ?? '', { imagePrefixes: options.imagePrefixes }),
		date: comment.createdAt,
		pinned: Boolean(comment.pin),
		identity,
		provider: identity === 'guest' ? undefined : providerOf(comment.authProvider),
		// 只取这一个布尔值（reader 整行带读者邮箱）；core 只给顶层评论挂 reader，回复标不了
		member: identity === 'reader' && comment.reader?.isMember === true ? true : undefined,
		parentId: comment.parentCommentId && comment.parentCommentId !== comment.rootCommentId ? comment.parentCommentId : undefined,
		location: locationLabelOf(comment.location, comment.countryCode),
		editedAt: typeof comment.editedAt === 'string' && comment.editedAt ? comment.editedAt : undefined,
		authorTag,
		// 编辑框的预填：只给还在可编辑时间内的读者评论，别的不多带一份原文
		source: authorTag && isEditableAt(comment.createdAt, options.now ?? Date.now()) ? comment.text ?? '' : undefined,
		// 划词评论只有顶层评论能带（core 的回复接口不收 anchor）
		anchor: comment.parentCommentId || comment.rootCommentId ? undefined : commentAnchorOf(comment.anchor, options.anchorBlocks),
	}
}

export function threadFromModel(thread: RawThread, options: CommentMapOptions = {}): CommentThread {
	const window = thread.replyWindow
	return {
		...commentFromModel(thread, options),
		replies: (thread.replies ?? []).map(reply => commentFromModel(reply, options)),
		hidden: window?.hasHidden && window.nextCursor
			? { count: window.hiddenCount ?? 0, cursor: window.nextCursor }
			: undefined,
	}
}

export async function loadCommentPage(client: MxClient, refId: string, page: number, options: CommentMapOptions & { sort?: CommentSort } = {}): Promise<CommentPage> {
	const sort = options.sort && options.sort !== 'pinned' ? options.sort : undefined
	const res = await client.comment.getByRefId(refId, { page, size: COMMENT_PAGE_SIZE, sort })
	return paged((res.data as RawThread[]).map(thread => threadFromModel(thread, options)), res.pagination, page)
}

/** `GET /comments/:id` 里只用得到的几个字段。这个接口会带出 ip、UA、回复者的邮箱，还不按审核状态过滤（core-issues），只在服务端读这几项 */
interface RawCommentRef {
	id?: string
	refId?: string
	rootCommentId?: string | null
	readerId?: string | null
	createdAt?: string
	isWhispers?: boolean
	isDeleted?: boolean
	state?: number
}

/** 匿名、跳过 core 的 15 秒缓存取一条评论（404 时抛出） */
function loadCommentRef(client: MxClient, id: string) {
	return client.proxy('comments')(id).get<RawCommentRef>({ params: { ts: Date.now() } })
}

/**
 * 按 id 找评论所在的楼层（#24）。可见性交给 core 的公开列表判断，不信 `GET /comments/:id` 的结果：
 * 顶层评论用 `around` 让 core 定位到它那一页，页里有它才算公开；回复在它那层楼的公开回复里找（最多翻 5 批）。
 * `GET /comments/:id` 只用来确认属于这篇内容、取楼主的 id，其余字段一概不碰。找不到返回 `undefined`
 */
export async function locateComment(client: MxClient, refId: string, id: string, options: CommentMapOptions = {}): Promise<CommentLocateResult | undefined> {
	const raw = await loadCommentRef(client, id).catch((error) => {
		if (classifyMxError(error).kind === 'not-found')
			return undefined
		throw error
	})
	if (!raw || raw.refId !== refId || raw.isWhispers || raw.isDeleted)
		return undefined
	const rootId = raw.rootCommentId || id
	const res = await client.proxy('comments')('ref')(refId).get<{ data: RawThread[] }>({ params: { around: rootId, size: COMMENT_PAGE_SIZE, ts: Date.now() } })
	const root = res.data.find(thread => thread.id === rootId)
	if (!root)
		return undefined
	const thread = threadFromModel(root, options)
	if (rootId === id || thread.replies.some(reply => reply.id === id))
		return { thread, targetId: id }
	// 楼层长、回复在折叠的中段里：沿游标往后翻
	let cursor = thread.hidden?.cursor
	for (let i = 0; cursor && i < 5; i++) {
		const batch = await loadThreadBatch(client, rootId, cursor, options)
		const at = thread.replies.findIndex(reply => reply.id === cursor) + 1
		thread.replies.splice(at, 0, ...batch.replies)
		const left = (thread.hidden?.count ?? 0) - batch.replies.length
		thread.hidden = batch.cursor && left > 0 ? { count: left, cursor: batch.cursor } : undefined
		if (batch.replies.some(reply => reply.id === id))
			return { thread, targetId: id }
		cursor = thread.hidden?.cursor
	}
	return undefined
}

/** 展开折叠的中段，每次 10 条（core 定的） */
export async function loadThreadBatch(client: MxClient, rootId: string, cursor?: string, options: CommentMapOptions = {}): Promise<CommentThreadBatch> {
	const res = await client.comment.getThreadReplies(rootId, cursor ? { cursor } : {})
	return {
		replies: (res.replies as RawComment[]).map(reply => commentFromModel(reply, options)),
		cursor: res.done ? undefined : res.nextCursor ?? undefined,
	}
}

const SNOWFLAKE = /^\d{1,20}$/

/**
 * 浏览器交来的请求体 → `CommentDraft`；不合要求时返回给读者看的提示。
 * 长度上限照 core 的校验，先在这里挡掉，免得白打一次 core
 */
export function parseCommentDraft(body: unknown): CommentDraft | string {
	const input = objectField(body)
	const text = stringField(input.text)
	if (!text)
		return msg('comment.writeSomethingBeforeSending')
	if (text.length > 500)
		return msg('comment.commentsCanUp')
	if (input.as !== 'guest' && input.as !== 'reader')
		return msg('comment.invalidIdentity')
	const parentId = input.parentId === undefined ? undefined : SNOWFLAKE.test(String(input.parentId)) ? String(input.parentId) : null
	if (parentId === null)
		return msg('comment.commentYoureReplying')
	const anchor = parseAnchorInput(input.anchor)
	if (anchor === null || (anchor && parentId))
		return msg('comment.selectedTextIsntValid')
	const draft: CommentDraft = { text, as: input.as, parentId, whisper: input.whisper === true || undefined, anchor }
	if (input.as === 'reader')
		return draft

	const guest = objectField(input.guest)
	const author = stringField(guest.author)
	const mail = stringField(guest.mail)
	const url = stringField(guest.url)
	if (!author || author.length > 20)
		return msg('comment.nicknameRequiredUp')
	if (!isMailAddress(mail))
		return msg('comment.emailRequiredUp')
	if (url && (url.length > 50 || !safeUrl(url)))
		return msg('comment.websiteMustStart')
	return { ...draft, guest: { author, mail, url: url || undefined } }
}

function create(client: MxClient, refId: string, draft: CommentDraft, anchor?: CoreRangeAnchor | CoreBlockAnchor) {
	const { text, parentId } = draft
	const anchored = anchor ? { anchor } : {}
	if (draft.as === 'reader') {
		return parentId
			? client.comment.readerReply(parentId, { text })
			: client.comment.readerComment(refId, { text, isWhispers: draft.whisper, ...anchored } as never)
	}
	const guest = { author: draft.guest!.author, mail: draft.guest!.mail, ...(draft.guest!.url ? { url: draft.guest!.url } : {}), text }
	// 回复的悄悄话属性由 core 从上级继承，传了也不认
	return parentId
		? client.comment.guestReply(parentId, guest)
		: client.comment.guestComment(refId, { ...guest, isWhispers: draft.whisper, ...anchored } as never)
}

/**
 * 发完之后回查一次，判断公开列表里看不看得到。「评论需审核」的开关不在公开接口里，只能这样看。
 * 回查本身失败时按看得到处理：评论已经发出去了，不该让读者以为失败。
 *
 * core 对公开的 GET 按网址缓存 15 秒，查询参数里有 `ts` 时跳过（`cache.interceptor.ts`）。
 * 回查必须带它，否则拿到的是几秒前别人回查时的旧列表，新评论会被误判成待审核（实测）
 */
async function statusOf(client: MxClient, refId: string, created: RawComment): Promise<CommentSubmitStatus> {
	if (created.isWhispers)
		return 'whisper'
	const ts = Date.now()
	try {
		if (!created.rootCommentId) {
			// api-client 的 getByRefId 不透传额外参数，只好走 proxy
			const res = await client.proxy('comments')('ref')(refId).get<{ data: { id: string }[] }>({ params: { page: 1, size: 1, sort: 'newest', ts } })
			return res.data.some(item => item.id === created.id) ? 'visible' : 'pending'
		}
		const thread = await client.comment.getThreadReplies(created.rootCommentId, { ts } as { cursor?: string })
		// 楼层超过 20 条时这里只拿到中段，查不全
		if (!thread.done)
			return 'visible'
		return thread.replies.some(item => item.id === created.id) ? 'visible' : 'pending'
	}
	catch {
		return 'visible'
	}
}

/** `anchor` 是服务端按正文重建好的锚点（`buildAnchor`），浏览器交来的不直接用 */
export async function submitComment(client: MxClient, refId: string, draft: CommentDraft, options: CommentMapOptions = {}, anchor?: CoreRangeAnchor | CoreBlockAnchor): Promise<CommentSubmitResult> {
	const created = await create(client, refId, draft, anchor) as RawComment
	return { comment: commentFromModel(created, options), status: await statusOf(client, refId, created) }
}

/**
 * 发评论失败 → 给读者看的提示。**只用固定文案**：core 的 message 是英文，且可能带外部输入。
 * 状态码按实测（2026-09-24）：昵称与站长同名 400 `INVALID_PARAMETER`、没登录 401 `AUTH_NOT_LOGGED_IN`、
 * 20 秒内重复 409、格式不对 400 `VALIDATION_FAILED`
 */
export function commentErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.code) {
		case 'COMMENT_DISABLED':
			return { statusCode: 403, message: msg('comment.commentsClosed') }
		case 'COMMENT_FORBIDDEN':
			return { statusCode: 403, message: msg('comment.anonymousCommentsArent') }
		case 'AUTH_NOT_LOGGED_IN':
		case 'AUTH_SESSION_EXPIRED':
			return { statusCode: 401, message: msg('common.sessionHasExpired') }
		case 'INVALID_PARAMETER':
			return { statusCode: 400, message: msg('comment.nicknameIsntAllowed') }
		case 'VALIDATION_FAILED':
			return { statusCode: 400, message: msg('comment.invalidInputNickname') }
	}
	if (failure.status === 409)
		return { statusCode: 409, message: msg('comment.justPostedSame') }
	switch (failure.kind) {
		case 'not-found':
			return { statusCode: 404, message: msg('comment.commentYoureReplyingDoesnt') }
		case 'rate-limited':
			return { statusCode: 429, message: msg('comment.yourePostingToo') }
		case 'unavailable':
			return { statusCode: 503, message: msg('comment.commentsTemporarilyUnavailablePlease') }
		default:
			return { statusCode: 500, message: msg('comment.commentWasntSent') }
	}
}

interface RawSession {
	id?: string | null
	name?: string | null
	displayUsername?: string | null
	handle?: string | null
	image?: string | null
	provider?: string | null
	role?: string | null
}

/**
 * `GET /auth/session` → 当前读者。只取昵称、头像、登录方式和是否站长，邮箱等一概不要；
 * 读者 id 不下发，给了 `tagOf` 时换成不透明标识
 */
export function readerFromSession(session: unknown, tagOf?: (readerId: string) => string): ReaderSession | null {
	if (!session || typeof session !== 'object')
		return null
	const data = session as RawSession
	const name = data.name?.trim() || data.displayUsername?.trim() || data.handle?.trim()
	if (!name)
		return null
	const isOwner = data.role === 'owner'
	return {
		name,
		avatar: httpsUrl(data.image),
		provider: providerOf(data.provider),
		isOwner,
		tag: !isOwner && typeof data.id === 'string' && data.id && tagOf ? tagOf(data.id) : undefined,
	}
}

export async function loadReaderSession(client: MxClient, tagOf?: (readerId: string) => string) {
	return readerFromSession(await client.proxy('auth')('session').get<unknown>(), tagOf)
}

/** 服务端自己用的会话身份（读者 id 与是否站长），不往外传 */
export async function loadSessionIdentity(client: MxClient): Promise<{ id: string, isOwner: boolean } | undefined> {
	const data = objectField(await client.proxy('auth')('session').get<unknown>().catch(() => undefined))
	const id = stringField(data.id)
	return id ? { id, isOwner: data.role === 'owner' } : undefined
}

/** 编辑时浏览器交来的正文，规则与发评论相同；不合要求时返回提示 */
export function parseCommentEdit(body: unknown): string | { error: string } {
	const text = stringField(objectField(body).text)
	if (!text)
		return { error: msg('comment.writeSomethingBefore') }
	if (text.length > 500)
		return { error: msg('comment.commentsCanUp') }
	return text
}

/** 编辑失败 → 固定文案 */
export class CommentEditRefused extends Error {
	statusCode: number
	constructor(statusCode: number, message: string) {
		super(message)
		this.statusCode = statusCode
	}
}

/**
 * 改自己的评论（#28）。`session` 带读者 cookie，`anonymous` 不带：
 * 站长的 cookie 在 core 那里能改任何人的评论，一律拒绝，站长去后台改；
 * 再匿名取一次这条评论，确认是本人的、还在发出后的 10 分钟内（core 自己也查本人，不查时间）。
 * core 编辑成功是 204 没有内容，正文由这里按同一套白名单渲染后返回
 */
export async function editComment(session: MxClient, anonymous: MxClient, id: string, text: string, options: CommentMapOptions = {}): Promise<CommentEditResult> {
	const me = await loadSessionIdentity(session)
	if (!me)
		throw new CommentEditRefused(401, msg('common.sessionHasExpired'))
	if (me.isOwner)
		throw new CommentEditRefused(403, msg('comment.ownerPleaseEdit'))
	const raw = await loadCommentRef(anonymous, id).catch((error) => {
		if (classifyMxError(error).kind === 'not-found')
			return undefined
		throw error
	})
	if (!raw || raw.isDeleted)
		throw new CommentEditRefused(404, msg('comment.commentDoesntExist'))
	if (raw.readerId !== me.id)
		throw new CommentEditRefused(403, msg('comment.canOnlyEdit'))
	// 多给一分钟，免得页面上的按钮还在、点下去却过了时间
	if (!isEditableAt(raw.createdAt, (options.now ?? Date.now()) - 60_000))
		throw new CommentEditRefused(403, msg('comment.commentsCantEdited'))
	await session.proxy('comments')('edit')(id).patch({ data: { text } })
	return { body: renderCommentBody(text, { imagePrefixes: options.imagePrefixes }), editedAt: new Date(options.now ?? Date.now()).toISOString() }
}

/** 编辑评论时 core 报的错 → 固定文案 */
export function commentEditErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.code) {
		case 'AUTH_NOT_LOGGED_IN':
		case 'AUTH_SESSION_EXPIRED':
			return { statusCode: 401, message: msg('common.sessionHasExpired') }
		case 'COMMENT_FORBIDDEN':
			return { statusCode: 403, message: msg('comment.canOnlyEdit') }
	}
	switch (failure.kind) {
		case 'not-found':
			return { statusCode: 404, message: msg('comment.commentDoesntExist') }
		case 'rate-limited':
			return { statusCode: 429, message: msg('common.tooManyRequests') }
		case 'unavailable':
			return { statusCode: 503, message: msg('comment.commentsTemporarilyUnavailablePlease') }
		default:
			return { statusCode: 500, message: msg('comment.couldntSavePlease') }
	}
}

/**
 * 读者屏蔽这条评论的作者（同时举报这条）：core 的 `report-and-block`，要读者登录；
 * 游客的评论、自己的评论不能屏蔽（core 回 INVALID_PARAMETER）。core 没有解除屏蔽的接口
 */
export async function blockCommentAuthor(client: MxClient, id: string) {
	await client.proxy('comments')(id)('report-and-block').post({ data: {} })
}

export function blockErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.code) {
		case 'AUTH_NOT_LOGGED_IN':
		case 'AUTH_SESSION_EXPIRED':
			return { statusCode: 401, message: msg('common.sessionHasExpired') }
		case 'INVALID_PARAMETER':
			return { statusCode: 400, message: msg('comment.personCantBlocked') }
	}
	switch (failure.kind) {
		case 'not-found':
			return { statusCode: 404, message: msg('comment.commentDoesntExist') }
		case 'rate-limited':
			return { statusCode: 429, message: msg('common.tooManyRequests') }
		default:
			return { statusCode: 503, message: msg('comment.couldntBlockPlease') }
	}
}

/** 置顶失败 → 固定文案 */
export function pinErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	return failure.kind === 'not-found'
		? { statusCode: 404, message: msg('comment.commentDoesntExist') }
		: { statusCode: 503, message: msg('comment.couldntUpdatePin') }
}

/** 站长置顶或取消置顶（core 的 `PATCH /comments/:id`，要站长会话；置顶前 core 会清掉同篇别的置顶） */
export async function pinComment(client: MxClient, id: string, pin: boolean) {
	await client.proxy('comments')(id).patch({ data: { pin } })
}

/** 站长改任何人的评论（不限时间，Yohaku 如此）；正文照同一套白名单渲染后返回。会话是不是站长由调用方先查 */
export async function ownerEditComment(session: MxClient, id: string, text: string, options: CommentMapOptions = {}): Promise<CommentEditResult> {
	await session.proxy('comments')('edit')(id).patch({ data: { text } })
	return { body: renderCommentBody(text, { imagePrefixes: options.imagePrefixes }), editedAt: new Date(options.now ?? Date.now()).toISOString() }
}

/** 举报一条评论：core 按读者或 IP 去重 90 天，第一次举报才通知站长。永远回 `{ ok: true }`，不存在时 404 */
export async function reportComment(client: MxClient, id: string) {
	await client.proxy('comments')(id)('report').post({ data: {} })
}

export function reportErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.kind) {
		case 'not-found':
			return { statusCode: 404, message: msg('comment.commentDoesntExist') }
		case 'rate-limited':
			return { statusCode: 429, message: msg('comment.youreReportingToo') }
		default:
			return { statusCode: 503, message: msg('comment.couldntSendReport') }
	}
}

/** 站长编辑评论时预填的原文（markdown）；带 `ts` 绕过 core 的缓存。取不到是 undefined */
export async function loadCommentSource(client: MxClient, id: string) {
	const raw = await client.proxy('comments')(id).get<{ text?: unknown }>({ params: { ts: Date.now() } }).catch(() => undefined)
	return typeof raw?.text === 'string' ? raw.text : undefined
}

interface RawAnchored {
	id: string
	author?: string | null
	avatar?: string | null
	text?: string | null
	createdAt?: string | null
	replyCount?: number | null
	anchor?: unknown
	parentCommentId?: string | null
	rootCommentId?: string | null
}

/**
 * 正文高亮与段落边栏用：这篇带锚点的顶层评论（最多 50 条）：块 id、引用（段落评论没有）、是第几处、评论者、头像、摘要、时间与回复数。
 * 头像与评论区一样只认可信名单（`avatarHosts` 是站点自己的域名）。
 * 引用在当前正文（`blocks`，匿名取的）里找不到的不给。带 `ts` 跳过 core 的缓存（新评论要马上高亮）
 */
export async function loadCommentHighlights(client: MxClient, refId: string, blocks: Record<string, AnchorBlock>, avatarHosts: readonly string[] = []): Promise<CommentHighlight[]> {
	const res = await client.proxy('comments')('ref')(refId).get<{ data: RawAnchored[] }>({ params: { hasAnchor: 'true', size: 50, ts: Date.now() } })
	return (res.data ?? []).flatMap((comment) => {
		if (comment.parentCommentId || comment.rootCommentId)
			return []
		const highlight = anchorHighlightOf(comment.id, comment.anchor, blocks)
		if (!highlight)
			return []
		const avatar = trustedAvatarOf(comment.avatar, avatarHosts)
		return [{
			...highlight,
			author: comment.author?.trim().slice(0, 20) || msg('common.anonymous'),
			...(avatar ? { avatar } : {}),
			excerpt: commentExcerptOf(comment.text ?? '', 80),
			...(typeof comment.createdAt === 'string' ? { date: comment.createdAt } : {}),
			...(Number.isSafeInteger(comment.replyCount) && comment.replyCount! > 0 ? { replyCount: comment.replyCount! } : {}),
		}]
	})
}

interface RawMyComment {
	id?: unknown
	refId?: unknown
	refType?: unknown
	source?: { categorySlug?: unknown, nid?: unknown, slug?: unknown } | null
	sourceTitle?: unknown
	text?: unknown
	createdAt?: unknown
}

const SLUG = /^[^/\\?#\s]{1,200}$/
const SNOWFLAKE_ID = /^[1-9]\d{0,18}$/

function slugPart(value: unknown) {
	return typeof value === 'string' && SLUG.test(value) && value !== '.' && value !== '..' ? encodeURIComponent(value) : undefined
}

/** 评论所在内容的站内地址（`refType` 是 core 的集合名） */
export function myCommentPathOf(raw: RawMyComment) {
	const source = raw.source
	if (!source)
		return undefined
	switch (raw.refType) {
		case 'posts':
		case 'post': {
			const category = slugPart(source.categorySlug)
			const slug = slugPart(source.slug)
			return category && slug ? `/posts/${category}/${slug}` : undefined
		}
		case 'notes':
		case 'note':
			return typeof source.nid === 'number' && Number.isInteger(source.nid) && source.nid > 0 ? `/notes/${source.nid}` : undefined
		case 'pages':
		case 'page': {
			const slug = slugPart(source.slug)
			return slug ? `/${slug}` : undefined
		}
		case 'recentlies':
		case 'recently':
			return typeof raw.refId === 'string' && SNOWFLAKE_ID.test(raw.refId) ? `/thinking/${raw.refId}` : undefined
	}
}

/**
 * 「我的评论」里一条的状态。core 的 `reader/me` 不给审核状态，这里匿名、跳过缓存问一次：
 * 404 是悄悄话（非站长看悄悄话一律 404；已删除的 `reader/me` 本来就不给）；`state` 1 是已通过；
 * 0 要看站长开没开审核，公开接口里没有这个开关，只好去公开列表里找它
 */
async function myCommentStatusOf(client: MxClient, id: string): Promise<MyCommentStatus> {
	try {
		const raw = await loadCommentRef(client, id).catch((error) => {
			if (classifyMxError(error).kind === 'not-found')
				return undefined
			throw error
		})
		if (!raw)
			return 'whisper'
		if (raw.isWhispers)
			return 'whisper'
		if (raw.state === 1)
			return 'visible'
		if (raw.state !== 0 || !raw.refId)
			return 'unknown'
		if (!raw.rootCommentId) {
			const res = await client.proxy('comments')('ref')(raw.refId).get<{ data: { id: string }[] }>({ params: { around: id, size: COMMENT_PAGE_SIZE, ts: Date.now() } })
			return res.data.some(item => item.id === id) ? 'visible' : 'pending'
		}
		const thread = await client.comment.getThreadReplies(raw.rootCommentId, { ts: Date.now() } as { cursor?: string })
		if (!thread.done)
			return 'unknown'
		return thread.replies.some(item => item.id === id) ? 'visible' : 'pending'
	}
	catch {
		return 'unknown'
	}
}

/**
 * 当前读者自己的评论（#29），一页 10 条，新的在前。`session` 带读者 cookie，`anonymous` 用来查每条的状态。
 * core 返回的 `text` 过同一套白名单，标题当纯文本、限长
 */
export async function loadMyComments(session: MxClient, anonymous: MxClient, page: number, options: CommentMapOptions = {}): Promise<MyCommentPage> {
	const res = await session.proxy('comments')('reader')('me').get<{ data: RawMyComment[], pagination?: { total?: number, totalPages?: number } }>({ params: { page, size: COMMENT_PAGE_SIZE } })
	const rows = (Array.isArray(res.data) ? res.data : []).filter((row): row is RawMyComment & { id: string } => typeof row.id === 'string' && SNOWFLAKE_ID.test(row.id))
	const items = await Promise.all(rows.map(async (row): Promise<MyComment> => {
		const path = myCommentPathOf(row)
		const title = typeof row.sourceTitle === 'string' ? row.sourceTitle.replace(CONTROL, '').trim().slice(0, 60) : ''
		return {
			id: row.id,
			body: renderCommentBody(typeof row.text === 'string' ? row.text : '', { imagePrefixes: options.imagePrefixes }),
			date: typeof row.createdAt === 'string' ? row.createdAt : '',
			status: await myCommentStatusOf(anonymous, row.id),
			path: path && `${path}#comment-${row.id}`,
			title: title || undefined,
		}
	}))
	return paged(items, res.pagination as Parameters<typeof paged>[1], page)
}

/** core 上已配置的社交登录方式，全站一样 */
export async function loadAuthProviders(client: MxClient): Promise<string[]> {
	const providers = await client.proxy('auth')('providers').get<unknown>()
	return Array.isArray(providers) ? providers.filter((p): p is string => providerOf(p) !== undefined) : []
}
