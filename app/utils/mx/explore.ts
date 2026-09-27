/**
 * 时间线、项目、统计、sitemap、正在阅读。纯模块，由 server 路由调用。
 */
import type { ArticleProps } from '../../types/article'
import type { ReadingEntry } from '../../types/live'
import type { NoteNeighbors } from '../../types/note'
import type { ProjectProps } from '../../types/project'
import type { BlogStats, SiteUpdates } from '../../types/stats'
import type { TimelineEntry } from '../../types/timeline'
import type { MxClient } from './client'
import { countedWordsOf } from '~~/shared/utils/article'
import { safelyDecodeUriComponent } from '~~/shared/utils/link'
import { toZonedTemporal } from '~~/shared/utils/time'
import { projectFromModel, sitemapEntriesFrom, timelineFrom } from './adapter'

export async function loadTimeline(client: MxClient): Promise<TimelineEntry[]> {
	return timelineFrom(await client.aggregate.getTimeline() as Parameters<typeof timelineFrom>[0])
}

export async function loadProjects(client: MxClient): Promise<ProjectProps[]> {
	return (await client.project.getAll()).map(projectFromModel)
}

/** 站点时区里的年份：同一时刻在不同时区可能跨年 */
function yearOf(date: string | undefined, timeZone: string) {
	if (!date)
		return undefined
	try {
		return String(toZonedTemporal(date, timeZone).year)
	}
	catch {
		return undefined
	}
}

/**
 * 统计挂件：全部用已缓存的公开文章与时间线（游客可见的日记）算，与归档、时间线的口径一致，不再打 core。
 * core 的 `site_info`、`count_read_and_like` 是整表计数，会把草稿、加密日记也算进去，不用
 */
export function statsFrom(articles: ArticleProps[], timeline: TimelineEntry[], timeZone: string): BlogStats {
	const annual: BlogStats['annual'] = {}
	let words = 0
	let reads = 0
	let likes = 0
	let updated: string | undefined
	let first: string | undefined
	const earlier = (date: string | undefined) => {
		if (date && Number.isFinite(Date.parse(date)) && (!first || Date.parse(date) < Date.parse(first)))
			first = date
	}
	for (const article of articles) {
		const count = countedWordsOf(article)
		words += count
		reads += article.readCount ?? 0
		likes += article.likeCount ?? 0
		const year = yearOf(article.date, timeZone)
		if (year) {
			annual[year] ??= { posts: 0, words: 0 }
			annual[year].posts++
			annual[year].words += count
		}
		const touched = article.updated ?? article.date
		if (touched && (!updated || Date.parse(touched) > Date.parse(updated)))
			updated = touched
		earlier(article.date)
	}
	const notes = timeline.filter(entry => entry.type === 'note')
	for (const note of notes)
		earlier(note.date)
	return {
		total: { posts: articles.length, notes: notes.length, words, reads, likes },
		annual,
		updated,
		firstPublished: first,
	}
}

const UPDATE_WINDOW = 30 * 86_400_000

/**
 * `since` 之后发的公开文章与日记。`since` 夹在「30 天前」与「现在」之间：再早的不算「新」，
 * 未来的时间（浏览器时钟不准）按现在算，也就没有新内容
 */
export function updatesSince(articles: ArticleProps[], timeline: TimelineEntry[], since: number, now = Date.now()): SiteUpdates {
	if (!Number.isFinite(since))
		return { count: 0, items: [] }
	const from = Math.min(Math.max(since, now - UPDATE_WINDOW), now)
	const fresh = [
		...articles.map(article => ({ title: article.title ?? article.path, path: article.path, date: article.date ?? '' })),
		...timeline.filter(entry => entry.type === 'note').map(entry => ({ title: entry.title, path: entry.path, date: entry.date })),
	]
		.filter(item => Date.parse(item.date) > from)
		.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
	return { count: fresh.length, items: fresh.slice(0, 5) }
}

const NEIGHBORS = 5

/** 时间线里这篇日记前后各 5 篇（只有游客可见的日记）；这篇不在里面时两边都是空的 */
export function noteNeighborsOf(timeline: TimelineEntry[], nid: number): NoteNeighbors {
	const notes = timeline.filter(entry => entry.type === 'note').toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date))
	const at = notes.findIndex(entry => entry.path === `/notes/${nid}`)
	if (at < 0)
		return { newer: [], older: [] }
	const pick = (entry: TimelineEntry) => ({ title: entry.title, path: entry.path, date: entry.date })
	return {
		newer: notes.slice(Math.max(0, at - NEIGHBORS), at).reverse().map(pick),
		older: notes.slice(at + 1, at + 1 + NEIGHBORS).map(pick),
	}
}

export async function loadSitemapEntries(client: MxClient) {
	const items = await client.proxy('aggregate')('sitemap').get<{ url?: string, publishedAt?: string }[]>()
	return sitemapEntriesFrom(items as unknown as { url?: string, publishedAt?: string }[])
}

export const READING_BOARD_SIZE = 5

interface RawRoomRef {
	id?: string
	nid?: number
	title?: string
	slug?: string
	category?: { slug?: string } | null
}

interface RawRooms {
	roomCount?: Record<string, number>
	objects?: { posts?: RawRoomRef[], notes?: RawRoomRef[], pages?: RawRoomRef[] }
}

/**
 * 此刻有人在读的内容：`GET /activity/rooms` 的房间人数配上标题，人多的在前（全部，截断由调用方做）。
 * 房间名是 `article-<id>`；`lang:*` 等别的房间没有对应内容，自然被跳过
 */
export async function loadReadingNow(client: MxClient): Promise<ReadingEntry[]> {
	const res = await client.proxy('activity')('rooms').get<RawRooms>() as unknown as RawRooms
	const counts = res.roomCount ?? {}
	const entry = (ref: RawRoomRef, path: string | undefined): ReadingEntry[] => {
		const count = ref.id ? counts[`article-${ref.id}`] ?? 0 : 0
		return path && ref.title && count > 0 ? [{ title: ref.title, path, count }] : []
	}
	const objects = res.objects ?? {}
	return [
		...(objects.posts ?? []).flatMap(ref => entry(ref, ref.category?.slug && ref.slug ? `/posts/${ref.category.slug}/${ref.slug}` : undefined)),
		...(objects.notes ?? []).flatMap(ref => entry(ref, ref.nid ? `/notes/${ref.nid}` : undefined)),
		...(objects.pages ?? []).flatMap(ref => entry(ref, ref.slug ? `/${encodeURIComponent(ref.slug)}` : undefined)),
	].sort((a, b) => b.count - a.count)
}

/**
 * 「正在阅读」只留公开清单里的地址。core 的房间接口按 id 取标题、不看发布状态与密码，
 * 草稿、定时公开、没发布的内容只要有人进了它的房间，标题就会出现在所有访客的侧栏
 */
export function publicReadingOnly(entries: ReadingEntry[], publicPaths: Iterable<string>): ReadingEntry[] {
	const allowed = new Set([...publicPaths].map(safelyDecodeUriComponent))
	return entries.filter(entry => allowed.has(safelyDecodeUriComponent(entry.path)))
}

/** 累计阅读最多的文章与日记，取自缓存的文章列表与时间线（游客可见的日记），不多打 core */
export function topReadFrom(articles: ArticleProps[], timeline: TimelineEntry[] = []): ReadingEntry[] {
	return [
		...articles.map(article => ({ title: article.title ?? article.path, path: article.path, count: article.readCount ?? 0 })),
		...timeline.filter(entry => entry.type === 'note').map(entry => ({ title: entry.title, path: entry.path, count: entry.readCount ?? 0 })),
	]
		.filter(entry => entry.count > 0)
		.sort((a, b) => b.count - a.count)
		.slice(0, READING_BOARD_SIZE)
}

/** 阅读量上报：core 的 `/ack` 每调一次加一，去重在调用方 */
export async function reportRead(client: MxClient, kind: 'post' | 'note', id: string) {
	await client.proxy('ack').post({ data: { type: 'read', payload: { type: kind, id } } })
}
