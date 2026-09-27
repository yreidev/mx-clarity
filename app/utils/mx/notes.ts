/**
 * 日记、专栏、说说、碎碎念的取数。纯模块，由 server 路由调用。
 */
import type { NoteWrappedPayload } from '@mx-space/api-client'
import type { NoteDetail, NoteProps, Paged, SayProps, ThinkingProps, TopicDetail, TopicProps } from '../../types/note'
import type { MxClient } from './client'
import { languagesOf, noteFromModel, noteLink, sayFromModel, thinkingFields, topicFromModel, translationOf } from './adapter'
import { renderMarkdownBody } from './body'
import { uiLangOfClient } from './client'
import { commentExcerptOf } from './comment-body'
import { applyLinkPreviews, previewLookupOf } from './enrichment'
import { classifyMxError } from './errors'
import { contentExtrasOf } from './extras'
import { renderPostBody } from './render'

export const NOTE_PAGE_SIZE = 10
export const SAY_PAGE_SIZE = 20
export const THINKING_PAGE_SIZE = 10

interface Pagination {
	total?: number
	totalPages?: number
}

export function paged<T>(items: T[], pagination: Pagination | undefined, page: number): Paged<T> {
	return {
		items,
		page,
		totalPages: Math.max(1, pagination?.totalPages ?? 1),
		total: pagination?.total ?? items.length,
	}
}

/** 日记 nid → core 的 AI 摘要（没有 AI 摘要时是 core 从正文截的）；取不到时是空表 */
export async function loadNoteSummaries(client: MxClient, page: number, size: number): Promise<Map<number, string>> {
	const res = await client.note.getList(page, size, { withSummary: true }).catch(() => undefined)
	return new Map((res?.data ?? []).flatMap((note) => {
		const summary = (note as { summary?: unknown }).summary
		return typeof summary === 'string' && summary.trim() ? [[note.nid, summary.trim().slice(0, 300)] as const] : []
	}))
}

/**
 * 日记列表的一页。卡片上的摘要用 core 的 AI 摘要（没有 AI 摘要时是 core 从正文截的），另带 `withSummary` 请求一次：
 * 带它时 core 会去掉正文，阅读时间就没法算了。那一次失败时照旧用正文开头
 */
export async function loadNotePage(client: MxClient, page: number): Promise<Paged<NoteProps>> {
	const [res, summaries] = await Promise.all([
		client.note.getList(page, NOTE_PAGE_SIZE),
		loadNoteSummaries(client, page, NOTE_PAGE_SIZE),
	])
	// 带 ?lang= 取时 $meta 里有每篇是不是译文（前缀版的卡片标记用）
	const meta = (res as { $meta?: unknown }).$meta
	return paged(res.data.map((model) => {
		const note = noteFromModel(model)
		const summary = summaries.get(note.nid)
		return {
			...note,
			...(summary ? { excerpt: summary } : {}),
			...(languagesOf(meta, model.id)?.translated ? { translated: true } : {}),
		}
	}), res.pagination, page)
}

/** 定时公开的日记还没到公开时间 */
export function isScheduled(publicAt: unknown, now: number): publicAt is string {
	return typeof publicAt === 'string' && Date.parse(publicAt) > now
}

/**
 * 加密日记没带对密码时 core 整篇拒绝（403 `NOTE_FORBIDDEN`），这里转成 `{ locked: true }`，
 * 由页面显示密码框；其余错误照常抛出。
 * 定时公开、还没到时间的日记：core 对游客只清空了 `text`，Lexical 的 `content` 照常返回，
 * 这里整篇不下发，只给公开时间
 */
export async function loadNoteDetail(client: MxClient, nid: number, password?: string, now = Date.now()): Promise<NoteDetail> {
	let payload: NoteWrappedPayload
	try {
		payload = await client.note.getNoteByNid(nid, password ? { password } : undefined)
	}
	catch (error) {
		if (classifyMxError(error).code === 'NOTE_FORBIDDEN')
			return { locked: true, nid }
		throw error
	}
	// `$meta` 不可枚举，展开之前先取出来
	const $meta = (payload as { $meta?: unknown }).$meta
	const translation = translationOf($meta, payload.id)
	const languages = languagesOf($meta, payload.id)
	const { prev, next, ...note } = payload
	if (isScheduled(note.publicAt, now))
		return { locked: false, scheduled: true, nid, publicAt: note.publicAt }
	// 加密日记（带着密码解锁的）里的投票 core 找不到：换成静态列表
	const rendered = await renderPostBody(note, { enrichments: ($meta as { enrichments?: unknown } | undefined)?.enrichments, polls: !password, ui: uiLangOfClient(client) })
	return {
		locked: false,
		note: noteFromModel(note),
		...rendered,
		// mx 的 prev 是更新的一篇，next 是更早的一篇（实测）
		newer: noteLink(prev),
		older: noteLink(next),
		translation,
		languages,
		// 解锁进来的加密日记不给洞察与朗读（core 对它们也拿不到）
		extras: contentExtrasOf(note.meta, $meta, { locked: Boolean(password) }),
	}
}

const DATE_SLUG = /^[^/\\?#]{1,200}$/

/**
 * 日期加 slug 的日记地址（`/notes/2024/5/1/hello`，Yohaku 的写法）的四段：年月日按整数校验，slug 挡住能改写路径的字符。
 * 不合格返回 undefined
 */
export function noteDatePathOf(year: unknown, month: unknown, day: unknown, slug: unknown) {
	const int = (value: unknown, min: number, max: number) => {
		const n = typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : Number.NaN
		return n >= min && n <= max ? n : undefined
	}
	const y = int(year, 1970, 2999)
	const m = int(month, 1, 12)
	const d = int(day, 1, 31)
	const s = typeof slug === 'string' && DATE_SLUG.test(slug) && !/^(?:\.|%2e){1,2}$/i.test(slug) ? slug : undefined
	return y && m && d && s ? { year: y, month: m, day: d, slug: s } : undefined
}

/** 按日期加 slug 找日记的 nid（core 的 `GET /notes/:year/:month/:day/:slug`，也查旧 slug）；找不到返回 undefined */
export async function loadNoteNidByDate(client: MxClient, path: NonNullable<ReturnType<typeof noteDatePathOf>>) {
	const res = await client.proxy('notes')(String(path.year))(String(path.month))(String(path.day))(encodeURIComponent(path.slug)).get<unknown>()
	const note = res as { nid?: unknown, data?: { nid?: unknown } }
	const nid = note?.nid ?? note?.data?.nid
	return typeof nid === 'number' && nid > 0 ? nid : undefined
}

export async function loadTopics(client: MxClient): Promise<TopicProps[]> {
	const topics = await client.topic.getAll()
	return topics.map(topicFromModel)
}

/**
 * 专栏详情。`description` 按 markdown 渲染（官方主题也是这样写的），走正文的路径 B、同一套净化；
 * `introduce` 是一句话简介，照旧纯文本
 */
export async function loadTopicDetail(client: MxClient, slug: string, page: number): Promise<TopicDetail> {
	const topic = await client.topic.getTopicBySlug(slug)
	const [res, description] = await Promise.all([
		client.note.getNoteByTopicId(topic.id, page, NOTE_PAGE_SIZE),
		topic.description?.trim() ? renderMarkdownBody(topic.description, uiLangOfClient(client)).then(rendered => rendered.body) : undefined,
	])
	return { topic: topicFromModel(topic), descriptionBody: description, notes: paged(res.data.map(noteFromModel), res.pagination, page) }
}

export async function loadSayPage(client: MxClient, page: number): Promise<Paged<SayProps>> {
	const res = await client.say.getAllPaginated(page, SAY_PAGE_SIZE)
	return paged(res.data.map(sayFromModel), res.pagination, page)
}

async function thinkingFrom(item: Parameters<typeof thinkingFields>[0]): Promise<ThinkingProps> {
	// 碎碎念的正文是 markdown，走路径 B
	const { body } = await renderMarkdownBody(item.content ?? '')
	// 碎碎念的链接卡片数据在每条的 enrichments 里（不在 $meta）
	applyLinkPreviews(body, previewLookupOf((item as { enrichments?: unknown }).enrichments))
	return { ...thinkingFields(item), body, excerpt: commentExcerptOf(item.content ?? '', 120) }
}

/** 碎碎念按游标翻页：`before` 是上一页最后一条的 id；没有更多时 `next` 为空 */
export async function loadThinking(client: MxClient, before?: string) {
	const list = await client.recently.getList({ before, size: THINKING_PAGE_SIZE })
	const items = await Promise.all(list.map(thinkingFrom))
	return { items, next: items.length === THINKING_PAGE_SIZE ? items.at(-1)?.id : undefined }
}

/** 单条碎碎念；不存在时是 `undefined`：core 查不到时回 200 `{ data: null }`，不是 404 */
export async function loadThinkingItem(client: MxClient, id: string): Promise<ThinkingProps | undefined> {
	const item = await client.recently.getById(id) as Parameters<typeof thinkingFrom>[0] | null
	return item ? thinkingFrom(item) : undefined
}
