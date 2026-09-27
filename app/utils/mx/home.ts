/**
 * 首页聚合：最近动态（`/activity/recent` 的评论、`/aggregate/top` 的碎碎念）、喜欢本站、随机说说。纯模块：聚合由服务端取，喜欢本站在浏览器里直连 core。
 *
 * 这几个接口会带出不该公开的东西，映射一律只挑白名单字段：
 * - 日记条目带着 `location`、`coordinates`（core 在这几个接口上没置空）：日记一概不从这里取；
 * - 被评论、被碎碎念引用的内容用 `findGlobalByIds` 查，不看发布状态与密码：标题与地址只认主题缓存的公开集合，
 *   找不到的整条丢掉（评论正文本身可能在谈那篇加密内容）；
 * - 评论的作者可能是读者邮箱 @ 前那一段、头像是游客随便填的：昵称纯文本限长，头像过可信名单
 */
import type { RecentActivity } from '../../types/home'
import type { SayProps, ThinkingProps } from '../../types/note'
import type { MxClient } from './client'
import { msg } from '~~/shared/utils/i18n'
import { safelyDecodeUriComponent } from '~~/shared/utils/link'
import { commentExcerptOf } from './comment-body'
import { trustedAvatarOf } from './comments'
import { classifyMxError } from './errors'

/** 公开内容（文章、游客可见的日记、独立页）：解码后的地址 → 缓存里的地址与标题，由调用方从缓存里拼 */
export type PublicIndex = ReadonlyMap<string, { path: string, title: string }>

const CONTROL = /[\p{Cc}\p{Cf}]/gu

function plain(value: unknown, max: number) {
	// 先把换行等空白并成空格，再去掉其余控制字符（换行也是控制字符，先去掉的话两行会粘在一起）
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(CONTROL, '').trim().slice(0, max) : ''
}

/** 按解码后的路径比对（缓存里的地址有的编码了、有的没有）；标题与地址都用缓存里的，不用 core 这次给的 */
export function publicIndexOf(entries: Iterable<{ path: string, title?: string }>): PublicIndex {
	return new Map([...entries].map(entry => [safelyDecodeUriComponent(entry.path), { path: entry.path, title: entry.title || msg('site.untitled') }]))
}

function lookup(index: PublicIndex, path: string | undefined) {
	return path ? index.get(safelyDecodeUriComponent(path)) : undefined
}

const SNOWFLAKE = /^[1-9]\d{0,18}$/
const SLUG = /^[^/\\?#\s]{1,200}$/

function slugOf(value: unknown) {
	return typeof value === 'string' && SLUG.test(value) && value !== '.' && value !== '..' ? value : undefined
}

/** 碎碎念正文（markdown）的开头，纯文本 */
function thinkingExcerptOf(content: unknown) {
	return commentExcerptOf(typeof content === 'string' ? content : '', 80)
}

/** 「最近动态」里评论与碎碎念各留几条 */
export const RECENT_COMMENTS = 3
export const RECENT_THINKING = 2

/**
 * `/aggregate/top` → 最近的碎碎念。同一个接口里的日记带着位置，说说另有随机说说，都不取；
 * 碎碎念只取正文开头，引用的内容不带（挂件用不到，也就不用比对）
 */
export async function loadRecentThinking(client: MxClient): Promise<RecentActivity['thinking']> {
	const raw = await client.aggregate.getTop(5) as unknown as { recently?: { id?: unknown, content?: unknown, createdAt?: unknown }[] }
	return (Array.isArray(raw.recently) ? raw.recently : []).flatMap((item) => {
		const excerpt = thinkingExcerptOf(item.content)
		return typeof item.id === 'string' && SNOWFLAKE.test(item.id) && typeof item.createdAt === 'string' && excerpt
			? [{ id: item.id, excerpt, date: item.createdAt, path: `/thinking/${item.id}` }]
			: []
	}).slice(0, RECENT_THINKING)
}

interface RawRecentComment {
	createdAt?: unknown
	author?: unknown
	text?: unknown
	avatar?: unknown
	type?: unknown
	id?: unknown
	nid?: unknown
	slug?: unknown
	category?: { slug?: unknown } | null
}

/** 被评论的内容在本站的地址；类型是 core 的 `checkRefModelCollectionType`（小写单数） */
function targetPathOf(item: { type?: unknown, id?: unknown, nid?: unknown, slug?: unknown, category?: { slug?: unknown } | null }) {
	switch (item.type) {
		case 'post': {
			const category = slugOf(item.category?.slug)
			const slug = slugOf(item.slug)
			return category && slug ? `/posts/${category}/${slug}` : undefined
		}
		case 'note':
			return typeof item.nid === 'number' && Number.isInteger(item.nid) && item.nid > 0 ? `/notes/${item.nid}` : undefined
		case 'page': {
			const slug = slugOf(item.slug)
			return slug ? `/${slug}` : undefined
		}
	}
}

/**
 * `/activity/recent` → 最近的评论。`index` 是公开内容；碎碎念上的评论另认 `/thinking/<id>`。
 * 同一个接口里的点赞不取
 */
export async function loadRecentComments(client: MxClient, index: PublicIndex, avatarHosts: readonly string[] = []): Promise<RecentActivity['comments']> {
	const raw = await client.activity.getRecentActivities() as unknown as { comment?: RawRecentComment[] }
	return (Array.isArray(raw.comment) ? raw.comment : []).flatMap((comment) => {
		const target = comment.type === 'recently' && typeof comment.id === 'string' && SNOWFLAKE.test(comment.id)
			? { path: `/thinking/${comment.id}`, title: msg('common.thinking') }
			: lookup(index, targetPathOf(comment))
		const excerpt = commentExcerptOf(typeof comment.text === 'string' ? comment.text : '', 100)
		if (!target || !excerpt || typeof comment.createdAt !== 'string')
			return []
		return [{
			author: plain(comment.author, 32) || msg('common.anonymous'),
			avatar: trustedAvatarOf(comment.avatar, avatarHosts),
			excerpt,
			date: comment.createdAt,
			title: target.title,
			path: target.path,
		}]
	}).slice(0, RECENT_COMMENTS)
}

/** 喜欢本站的总数；core 的 `GET /like_this` 回一个数 */
export async function loadSiteLikes(client: MxClient) {
	const count = await client.proxy('like_this').get<unknown>()
	return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0
}

/**
 * 喜欢本站。core 按 IP 记（`POST /like_this`，204），同一个 IP 再点回 400「Once a day is enough」：当作已经喜欢过。
 * 按源码看这个集合从不清空，实际是每个 IP 只能点一次
 */
export async function likeSite(client: MxClient): Promise<'liked' | 'already'> {
	try {
		await client.proxy('like_this').post({ data: {} })
		return 'liked'
	}
	catch (error) {
		if (classifyMxError(error).status === 400)
			return 'already'
		throw error
	}
}

/** 全部说说（随机说说用），最多 200 条 */
export async function loadAllSays(client: MxClient): Promise<SayProps[]> {
	const res = await client.say.getAllPaginated(1, 100)
	const second = res.pagination && res.pagination.totalPages > 1 ? await client.say.getAllPaginated(2, 100).catch(() => undefined) : undefined
	return [...res.data, ...(second?.data ?? [])].flatMap((say): SayProps[] => {
		const text = plain(say.text, 300)
		return text ? [{ id: say.id, text, author: plain(say.author, 40) || undefined, source: plain(say.source, 60) || undefined, date: say.createdAt }] : []
	})
}

/**
 * 碎碎念引用的内容只在公开集合里找得到时才保留（标题换成缓存里的）；引用别的碎碎念照留（碎碎念都是公开的）。
 * core 按 id 取引用的标题，不看发布状态与密码，站长引用了草稿或加密日记时标题会露出来
 */
/** 碎碎念情境里的窗口标题隐私敏感：只在主题配置开了 `liveDesk.showWindowTitle` 时给 */
export function withWindowTitlePolicy<T extends Pick<ThinkingProps, 'context'>>(item: T, show: boolean): T {
	if (show || !item.context?.window)
		return item
	const { window: _window, ...rest } = item.context
	return { ...item, context: Object.keys(rest).length ? rest : undefined }
}

export function withPublicQuote<T extends Pick<ThinkingProps, 'quoted'>>(item: T, index: PublicIndex): T {
	const quoted = item.quoted
	if (!quoted || quoted.kind === 'thinking')
		return item
	const found = lookup(index, quoted.path)
	return { ...item, quoted: found ? { ...quoted, ...found } : undefined }
}
