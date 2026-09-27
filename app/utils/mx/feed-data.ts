import type { ArticleMappingOptions } from './adapter'
import type { MxClient } from './client'
/**
 * 订阅源的条目：文章、日记带全文，说说、碎碎念是纯文本。纯模块，由 server 路由调用。
 *
 * - 文章取 `GET /posts` 第一页（匿名）：锁定的付费文章 core 只给预览；**付费文章不论锁没锁都只放摘要**，
 *   限时公开期间列表给的是全文，收进阅读器就永远公开了；
 * - 日记取 `GET /notes` 第一页：core 对游客只给可见的（加密、定时公开的不在里面）；摘要用 core 的 AI 摘要
 *   （另带 `withSummary` 请求一次：带它时 core 会去掉正文）。
 */
import type { FeedEntry } from './feed'
import { articleFromPost, excerptOf, noteFromModel } from './adapter'
import { commentExcerptOf } from './comment-body'
import { FEED_LIMIT } from './feed'
import { feedHtmlOf } from './feed-html'
import { isScheduled, loadNoteSummaries } from './notes'
import { renderPostBody } from './render'

async function htmlOf(model: Parameters<typeof renderPostBody>[0], base: string, link: string) {
	try {
		return feedHtmlOf((await renderPostBody(model)).body, { base, link })
	}
	catch {
		return undefined
	}
}

/** 文章条目；`base` 是站点地址（相对地址转成绝对的） */
export async function loadFeedPosts(client: MxClient, base: string, options: ArticleMappingOptions = {}): Promise<FeedEntry[]> {
	const res = await client.post.getList(1, FEED_LIMIT)
	return Promise.all(res.data.map(async (post) => {
		const article = articleFromPost(post, options)
		const premium = Boolean((post as { isPremium?: boolean }).isPremium)
		const link = new URL(article.path, base).href
		return {
			title: article.title ?? article.path,
			path: article.path,
			// 没填摘要时用正文开头（付费文章的 text 本来就只有公开预览）
			summary: article.description || excerptOf(post.text ?? '') || undefined,
			image: article.image,
			category: article.categories?.[0],
			published: article.date ?? '',
			updated: article.updated,
			premium,
			html: premium ? undefined : await htmlOf(post, base, link),
		}
	}))
}

/** 日记条目：全文 + AI 摘要 */
export async function loadFeedNotes(client: MxClient, base: string): Promise<FeedEntry[]> {
	const [res, summaries] = await Promise.all([
		client.note.getList(1, FEED_LIMIT),
		loadNoteSummaries(client, 1, FEED_LIMIT),
	])
	// core 对游客本来就只给可见的；这里再挡一次加密与定时公开的（它们的正文不能进订阅源）
	const now = Date.now()
	return Promise.all(res.data.filter(note => !note.hasPassword && !isScheduled((note as { publicAt?: unknown }).publicAt, now)).map(async (model) => {
		const note = noteFromModel(model)
		return {
			title: note.title,
			path: note.path,
			summary: summaries.get(note.nid) || note.excerpt,
			image: note.cover,
			category: '日记',
			published: note.date,
			updated: note.updated,
			html: await htmlOf(model, base, new URL(note.path, base).href),
		}
	}))
}

/** 说说：纯文本，标题取开头 */
export async function loadFeedSays(client: MxClient): Promise<FeedEntry[]> {
	const res = await client.say.getAllPaginated(1, FEED_LIMIT)
	return res.data.flatMap((say) => {
		const text = say.text?.trim()
		if (!text)
			return []
		const by = [say.author, say.source && `《${say.source}》`].filter(Boolean).join(' ')
		return [{
			title: text.length > 30 ? `${text.slice(0, 30)}…` : text,
			path: `/says#say-${say.id}`,
			summary: by ? `${text} —— ${by}` : text,
			category: '说说',
			published: say.createdAt,
		}]
	})
}

/** 碎碎念：正文是 markdown，这里只取纯文本 */
export async function loadFeedThinking(client: MxClient): Promise<FeedEntry[]> {
	const list = await client.recently.getList({ size: FEED_LIMIT })
	return list.flatMap((item) => {
		const text = commentExcerptOf(item.content ?? '', 2000)
		if (!text)
			return []
		return [{
			title: text.length > 30 ? `${text.slice(0, 30)}…` : text,
			path: `/thinking/${item.id}`,
			summary: text,
			category: '碎碎念',
			published: item.createdAt,
			updated: item.modifiedAt || undefined,
		}]
	})
}
