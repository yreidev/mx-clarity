/**
 * 草稿预览：站长在 admin 里给草稿开分享链接，拿到链接的人不登录也能看。纯模块，由 server 路由调用。
 *
 * 分享令牌是 core 生成的 24 字节随机数（base64url，32 位），没有过期时间，站长关掉分享就失效。
 */
import type { DraftKind, DraftPreview } from '../../types/draft'
import type { MxClient } from './client'
import { msg } from '~~/shared/utils/i18n'
import { readingTimeOf } from './adapter'
import { renderPostBody } from './render'

const SHARE_TOKEN = /^[\w-]{16,128}$/
const KINDS = new Set<DraftKind>(['post', 'note', 'page'])

/** 令牌会拼进发往 core 的路径，先挡住别的字符 */
export function isShareToken(value: unknown): value is string {
	return typeof value === 'string' && SHARE_TOKEN.test(value)
}

interface RawSharedDraft {
	title?: string | null
	text?: string | null
	content?: string | null
	contentFormat?: string
	refType?: string
	createdAt?: string
}

/**
 * `GET /drafts/shared/:token`。**带 `ts` 绕过 core 对公开 GET 的 15 秒缓存**：
 * 作者改完草稿刷新预览，要看到的是刚存的版本；关掉分享后也不该还能看 15 秒
 */
export async function loadSharedDraft(client: MxClient, token: string): Promise<DraftPreview> {
	const draft = await client.proxy('drafts')('shared')(token).get<RawSharedDraft>({ params: { ts: Date.now() } }) as unknown as RawSharedDraft
	const kind = KINDS.has(draft.refType as DraftKind) ? draft.refType as DraftKind : 'post'
	const title = draft.title?.trim() || msg('post.untitledDraft')
	return {
		kind,
		article: {
			title,
			date: draft.createdAt,
			readingTime: readingTimeOf(draft.text ?? ''),
			path: `/preview/${token}`,
			meta: {},
		},
		// 与已发布的内容同一套渲染
		// 草稿还没发布，core 找不到里面的投票
		...await renderPostBody(draft, { polls: false }),
	}
}
