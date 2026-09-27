import type { CommentDraft, CommentEditResult, CommentHighlight, CommentLocateResult, CommentPage, CommentSort, CommentSubmitResult, CommentThreadBatch, MyCommentPage, ReaderState } from '~/types/comment'
import type { SiteConfig } from '~/types/site'
import type { ThemeConfig } from '~/types/theme'
import type { AnchorBlock } from '~/utils/mx/anchor'
import type { MxClient } from '~/utils/mx/client'
import type { CommentMapOptions } from '~/utils/mx/comments'
import { msg } from '~~/shared/utils/i18n'
import { buildAnchor } from '~/utils/mx/anchor'
import { commentImagePrefixesOf } from '~/utils/mx/comment-body'
import { blockCommentAuthor, blockErrorOf, commentEditErrorOf, CommentEditRefused, commentErrorOf, editComment, loadAuthProviders, loadCommentHighlights, loadCommentPage, loadCommentSource, loadMyComments, loadReaderSession, loadThreadBatch, locateComment, ownerEditComment, parseCommentDraft, parseCommentEdit, pinComment, pinErrorOf, reportComment, reportErrorOf, submitComment } from '~/utils/mx/comments'
import { pageErrorOf } from '~/utils/mx/errors'

/**
 * 评论区在浏览器里直连 core：列表、楼中楼、定位、划词高亮、发、改、举报、屏蔽、站长的置顶与改评论、我的评论。
 * 默认带着读者的 cookie；匿名发评论、举报、以游客身份核对评论状态时一个 cookie 都不带。
 * 映射用的站点设置（可信的头像域名、评论图片前缀、要不要显示「浏览器 · 系统」）取自站点与主题配置；
 * 读者在浏览器里就用 core 的读者 id 认「这条是我的」。划词评论的正文块由本站按匿名正文算好（`/api/mx/anchor-blocks/:refId`）
 */

const sameId = (id: string) => id

/** 同一篇的正文块 30 秒内只取一次（与服务端的缓存一样长） */
const BLOCKS_TTL = 30_000
const blockRequests = new Map<string, { at: number, promise: Promise<Record<string, AnchorBlock> | undefined> }>()

export function fetchAnchorBlocks(refId: string) {
	const cached = blockRequests.get(refId)
	if (cached && Date.now() - cached.at < BLOCKS_TTL)
		return cached.promise
	const promise = $fetch<{ blocks: Record<string, AnchorBlock> | null }>(`/api/mx/anchor-blocks/${refId}`).then(res => res.blocks ?? undefined, () => undefined)
	blockRequests.set(refId, { at: Date.now(), promise })
	return promise
}

function hostsOf(urls: (string | undefined)[]) {
	return urls.flatMap((url) => {
		try {
			return url ? [new URL(url).hostname] : []
		}
		catch {
			return []
		}
	})
}

/** 映射评论要看的站点设置：可信的头像域名（站点与站长头像所在的域名）、要不要显示「浏览器 · 系统」、评论图片的地址前缀 */
export function commentMapOptionsOf(site: SiteConfig, theme: ThemeConfig): CommentMapOptions {
	return {
		avatarHosts: hostsOf([site.webUrl, site.author.avatar]),
		showAgent: theme.comments.showAgent,
		imagePrefixes: commentImagePrefixesOf(site, theme.comments.imageHosts),
		tagOf: sameId,
	}
}

/** 当前读者与可用的登录方式；查不到的当作没登录、没有社交登录 */
export async function loadReaderState(core: () => MxClient): Promise<ReaderState> {
	const [reader, providers] = await Promise.all([
		loadReaderSession(core(), sameId).catch(() => null),
		loadAuthProviders(core()).catch(() => []),
	])
	return { reader, providers }
}

export function useCommentApi() {
	const core = useCoreClient()
	const guest = useCoreClient({ anonymous: true })
	const { data: site } = useMxSite()
	const { data: theme } = useMxTheme()

	const options = () => commentMapOptionsOf(site.value, theme.value)

	return {
		async page(refId: string, page: number, sort: CommentSort = 'pinned'): Promise<CommentPage> {
			const anchorBlocks = await fetchAnchorBlocks(refId)
			return callCore(() => loadCommentPage(core(), refId, page, { ...options(), anchorBlocks, sort }), pageErrorOf)
		},

		/** 按 id 找评论所在的楼层；找不到（没公开、不属于这篇）时是 404 */
		async locate(refId: string, id: string): Promise<CommentLocateResult> {
			const anchorBlocks = await fetchAnchorBlocks(refId)
			const found = await callCore(() => locateComment(core(), refId, id, { ...options(), anchorBlocks }), pageErrorOf)
			return found ?? refuse(404, msg('comment.commentNotFound'))
		},

		thread(rootId: string, cursor: string): Promise<CommentThreadBatch> {
			return callCore(() => loadThreadBatch(core(), rootId, cursor, options()), pageErrorOf)
		},

		/** 正文里带划词锚点的评论（高亮用），以游客身份取 */
		async highlights(refId: string): Promise<CommentHighlight[]> {
			const blocks = await fetchAnchorBlocks(refId)
			return blocks ? callCore(() => loadCommentHighlights(guest(), refId, blocks, options().avatarHosts), pageErrorOf) : []
		},

		/**
		 * 发评论或回复：先照 core 的规则校验；划词评论按当前正文核对引用、重建锚点，对不上就不发。
		 * 读者身份带 cookie，匿名身份一个 cookie 都不带
		 */
		async post(refId: string, input: CommentDraft): Promise<CommentSubmitResult> {
			const draft = parseCommentDraft(input)
			if (typeof draft === 'string')
				refuse(400, draft)
			const anchorBlocks = draft.anchor ? await fetchAnchorBlocks(refId) : undefined
			const anchor = draft.anchor && anchorBlocks ? buildAnchor(anchorBlocks, draft.anchor) : undefined
			if (draft.anchor && !anchor)
				refuse(400, msg('comment.selectedTextIsnt'))
			return callCore(() => submitComment(draft.as === 'reader' ? core() : guest(), refId, draft, { ...options(), anchorBlocks }, anchor), commentErrorOf)
		},

		/** 读者改自己的评论（发出后 10 分钟内）；每条的状态另以游客身份核对 */
		edit(id: string, input: string): Promise<CommentEditResult> {
			const text = parseCommentEdit({ text: input })
			if (typeof text !== 'string')
				refuse(400, text.error)
			return callCore(() => editComment(core(), guest(), id, text, options()).catch((error) => {
				if (error instanceof CommentEditRefused)
					refuse(error.statusCode, error.message)
				throw error
			}), commentEditErrorOf)
		},

		/** 站长：改任何人的评论 */
		ownerEdit(id: string, input: string): Promise<CommentEditResult> {
			const text = parseCommentEdit({ text: input })
			if (typeof text !== 'string')
				refuse(400, text.error)
			return callCore(() => ownerEditComment(core(), id, text, options()), commentEditErrorOf)
		},

		/** 站长：取一条评论的原文（编辑框预填）；取不到是 undefined */
		ownerSource(id: string) {
			return loadCommentSource(core(), id)
		},

		/** 站长：置顶或取消置顶一条顶层评论 */
		pin(id: string, pin: boolean) {
			return callCore(() => pinComment(core(), id, pin), pinErrorOf)
		},

		/** 举报一条评论：以游客身份（core 按 IP 去重） */
		report(id: string) {
			return callCore(() => reportComment(guest(), id), reportErrorOf)
		},

		/** 登录读者屏蔽这条评论的作者（同时举报这条）；撤销不了 */
		block(id: string) {
			return callCore(() => blockCommentAuthor(core(), id), blockErrorOf)
		},

		/** 当前读者自己的评论（会员页的「我的评论」），每条的状态另以游客身份核对 */
		mine(page: number): Promise<MyCommentPage> {
			return callCore(() => loadMyComments(core(), guest(), page, options()), pageErrorOf)
		},
	}
}
