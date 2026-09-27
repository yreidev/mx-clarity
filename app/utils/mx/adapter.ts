/**
 * 字段映射：mx 的模型 → 本地类型。唯一的翻译层。
 */
import type { AggregateRootWithTheme, AggregateSiteInfo, LinkModel, NoteModel, PageModel, PostModel, ProjectModel, RecentlyModel, SayModel, SeoOptionModel, TopicModel } from '@mx-space/api-client'
import type { ArticleImage, ArticleProps, ContentLanguages, ContentTranslation } from '../../types/article'
import type { FeedEntry, FeedGroup } from '../../types/feed'
import type { NoteLink, NoteProps, SayProps, ThinkingProps, TopicLink, TopicProps } from '../../types/note'
import type { ProjectProps } from '../../types/project'
import type { SearchHit, SearchHitType } from '../../types/search'
import type { SiteConfig } from '../../types/site'
import type { TimelineEntry } from '../../types/timeline'
import { msg } from '~~/shared/utils/i18n'
import { langCodeOf, SITE_LANG_CODE } from '~~/shared/utils/lang'
import blogConfig from '../../../blog.config'

// ———————————————————————————— 文章 ————————————————————————————

const SAFE_URL = /^https?:\/\//i

/** URL 字段一律过协议白名单，在适配层就洗干净 */
export function safeUrl(url: unknown) {
	return typeof url === 'string' && SAFE_URL.test(url) ? url : undefined
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const HAS_WORD = /[\p{L}\p{N}]/u

/** CJK 字符 ÷ 400 字/分钟 + 其余按空白分词 ÷ 200 词/分钟 */
export function readingTimeOf(text: string) {
	const cjk = text.match(CJK)?.length ?? 0
	const words = text.replace(CJK, ' ').split(/\s+/).filter(token => HAS_WORD.test(token)).length
	const minutes = cjk / 400 + words / 200
	return {
		text: `${Math.max(1, Math.round(minutes))} min read`,
		minutes,
		time: minutes * 60000,
		words: cjk + words,
	}
}

/**
 * `post.meta.type` → snippet 的分类映射 → app.config 的分类映射 → 第一个可用类型。
 * 取到的值不在 `allowed` 里时视为没取到。
 */
export function resolveArticleType(
	metaType: unknown,
	category: string | undefined,
	maps: Array<Record<string, unknown> | undefined>,
	allowed: readonly string[],
) {
	const candidates = [metaType, ...maps.map(map => (category ? map?.[category] : undefined))]
	const hit = candidates.find((value): value is string => typeof value === 'string' && allowed.includes(value))
	return hit ?? allowed[0] ?? 'tech'
}

export interface ArticleMappingOptions {
	/** 按顺序查找的分类 → 类型映射：snippet 的在前，app.config 的在后 */
	typeByCategory?: Array<Record<string, unknown> | undefined>
}

const ARTICLE_TYPES = Object.keys(blogConfig.article.types)

/**
 * `PostModel` → `ArticleProps`。
 * 丢弃的字段（主题没用上）：related、enrichments、categoryId。付费墙看 `$meta.paywall`，`isPremium` 只用来标记列表里的付费文章。
 */
export function articleFromPost(post: PostModel, options: ArticleMappingOptions = {}): ArticleProps {
	const meta = (post.meta ?? {}) as Record<string, unknown>
	const categoryName = post.category?.name
	// 封面是 admin 设置面板写入的 meta.cover（core 内置 meta 预设），images 只是正文图片的元数据
	const cover = safeUrl(meta.cover)
	const coverImage = cover ? post.images?.find(img => img.src === cover) : undefined
	// 参考链接会渲染成 <a href>，链接同样过白名单
	const references = Array.isArray(meta.references)
		? (meta.references as Array<{ title?: unknown, link?: unknown }>).map(ref => ({
				title: typeof ref?.title === 'string' ? ref.title : undefined,
				link: safeUrl(ref?.link),
			})).filter(ref => ref.title || ref.link)
		: undefined

	return {
		title: post.title,
		description: post.summary || undefined,
		date: post.createdAt,
		updated: post.modifiedAt || undefined,
		published: post.createdAt,
		categories: [categoryName || blogConfig.defaultCategory],
		tags: post.tags ?? [],
		type: resolveArticleType(meta.type, categoryName, options.typeByCategory ?? [], ARTICLE_TYPES) as ArticleProps['type'],
		image: cover,
		recommend: post.pinAt ? (post.pinOrder ?? 1) : undefined,
		references,
		draft: !post.isPublished,
		premium: post.isPremium === true || undefined,
		copyright: post.copyright === false ? false : undefined,
		permalink: undefined,
		readingTime: readingTimeOf(post.text ?? ''),
		readCount: post.readCount ?? 0,
		likeCount: post.likeCount ?? 0,
		path: `/posts/${post.category?.slug}/${post.slug}`,
		meta: {
			...meta,
			__id: post.id,
			__image: coverImage ? { ...coverImage } as ArticleImage : undefined,
		},
	}
}

// ———————————————————————————— 日记、专栏、说说、碎碎念 ————————————————————————————

/** 列表用的纯文本摘要：去掉 markdown 标记与代码块，取开头一段 */
export function excerptOf(text: string, length = 120) {
	// 逐行跳过代码围栏内部，避免对整段文本用带回溯的正则
	const lines: string[] = []
	let fence: string | undefined
	for (const line of text.split('\n')) {
		const marker = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1]
		if (marker && (!fence || marker[0] === fence))
			fence = fence ? undefined : marker[0]
		else if (!fence)
			lines.push(line.replace(/^\s{0,3}(?:#{1,6}|[>*+-]|\d+\.)\s+/, ''))
	}
	const plain = lines.join(' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[*_~`=|^]+/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	return plain.length > length ? `${plain.slice(0, length)}…` : plain
}

export function topicLink(topic: Pick<TopicModel, 'name' | 'slug'>): TopicLink {
	return { name: topic.name, slug: topic.slug, path: `/notes/series/${encodeURIComponent(topic.slug)}` }
}

export function topicFromModel(topic: TopicModel): TopicProps {
	return {
		...topicLink(topic),
		// description 按 markdown 写：列表与 SEO 用去掉标记的纯文本开头，详情页另行渲染
		description: excerptOf(topic.description ?? '', 200),
		introduce: topic.introduce ?? '',
		icon: safeUrl(topic.icon),
	}
}

export function noteFromModel(note: NoteModel): NoteProps {
	return {
		nid: note.nid,
		title: note.title,
		date: note.createdAt,
		updated: note.modifiedAt || undefined,
		mood: note.mood || undefined,
		weather: note.weather || undefined,
		bookmark: Boolean(note.bookmark),
		topic: note.topic ? topicLink(note.topic) : undefined,
		excerpt: excerptOf(note.text ?? ''),
		readingTime: readingTimeOf(note.text ?? ''),
		readCount: note.readCount ?? 0,
		likeCount: note.likeCount ?? 0,
		path: `/notes/${note.nid}`,
		cover: safeUrl((note.meta as Record<string, unknown> | undefined)?.cover),
		meta: { ...(note.meta ?? {}), __id: note.id },
	}
}

/** 前后篇只带了几个字段（`Partial<NoteModel>`） */
export function noteLink(note: Partial<NoteModel> | null | undefined): NoteLink | undefined {
	if (!note?.nid)
		return undefined
	return { nid: note.nid, title: note.title ?? '', date: note.createdAt, path: `/notes/${note.nid}` }
}

export function sayFromModel(say: SayModel): SayProps {
	return {
		id: say.id,
		text: say.text,
		author: say.author || undefined,
		source: say.source || undefined,
		date: say.createdAt,
	}
}

const SITE_PATH = /^\/(?![/\\])\S*$/
const REF_KINDS: Record<string, NonNullable<ThinkingProps['quoted']>['kind']> = { post: 'post', note: 'note', page: 'page', recently: 'thinking' }

function plainText(value: unknown, max: number) {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
}

/** 碎碎念引用的内容：core 已拼好站内地址（recently.service.ts 的 buildRefSummary） */
function thinkingRefOf(ref: unknown): ThinkingProps['quoted'] {
	if (typeof ref !== 'object' || ref === null)
		return undefined
	const { title, url, type } = ref as { title?: unknown, url?: unknown, type?: unknown }
	const path = typeof url === 'string' && SITE_PATH.test(url) ? url : undefined
	const kind = typeof type === 'string' ? REF_KINDS[type] : undefined
	const name = plainText(title, 200)
	return path && kind ? { title: name ?? msg('site.untitled'), path, kind } : undefined
}

/** companion 发布的碎碎念附带的情境（`metadata.kind === 'companion-moment'`） */
function companionContextOf(metadata: unknown): ThinkingProps['context'] {
	const meta = metadata as { kind?: unknown, application?: { displayName?: unknown, window?: { title?: unknown } | null } | null, media?: { title?: unknown, artist?: unknown } | null } | undefined
	if (meta?.kind !== 'companion-moment')
		return undefined
	const app = plainText(meta.application?.displayName, 60)
	const window = plainText(meta.application?.window?.title, 120)
	const title = plainText(meta.media?.title, 120)
	const artist = plainText(meta.media?.artist, 80)
	const media = title ? (artist ? `${title} - ${artist}` : title) : undefined
	return app || window || media ? { ...(app ? { app } : {}), ...(window ? { window } : {}), ...(media ? { media } : {}) } : undefined
}

/** 碎碎念不含正文 AST 的部分；正文由调用方按路径 B 渲染 */
export function thinkingFields(item: RecentlyModel) {
	return {
		id: item.id,
		date: item.createdAt,
		updated: item.modifiedAt || undefined,
		// type 字段不可靠（传 link 也被存成 text），只看有没有地址
		link: safeUrl(item.metadata?.url),
		up: item.up ?? 0,
		down: item.down ?? 0,
		// 缺省按允许（core 的默认值），只有明确关掉才不给评论区
		allowComment: (item as { allowComment?: boolean }).allowComment !== false,
		path: `/thinking/${item.id}`,
		quoted: thinkingRefOf((item as { ref?: unknown }).ref),
		context: companionContextOf(item.metadata),
	}
}

// ———————————————————————————— 搜索、时间线、项目、友链、独立页 ————————————————————————————

/** 内容在本站的地址；缺字段时返回 undefined，调用方丢掉这条 */
function contentPath(type: SearchHitType, item: { slug?: string, nid?: number, category?: { slug?: string } | null }) {
	switch (type) {
		case 'post':
			return item.category?.slug && item.slug ? `/posts/${encodeURIComponent(item.category.slug)}/${encodeURIComponent(item.slug)}` : undefined
		case 'note':
			return item.nid ? `/notes/${item.nid}` : undefined
		case 'page':
			return item.slug ? `/${encodeURIComponent(item.slug)}` : undefined
	}
}

const SEARCH_TYPES = new Set<string>(['post', 'note', 'page'])

interface RawSearchItem {
	type?: string
	id?: string
	title?: string
	slug?: string
	nid?: number
	category?: { name?: string, slug?: string } | null
	highlight?: { keywords?: unknown, snippet?: string | null } | null
	createdAt?: string
	summary?: string | null
	isPremium?: boolean
	meta?: { paywall?: { freeUntil?: unknown } | null } | null
}

/**
 * 付费文章（不在限时公开期内）的正文不能从搜索漏出去：
 * core 的搜索索引建在全文上，锁定时 `text` / `content` 截断了，`highlight.snippet` 却是从全文里截的
 */
function lockedForSearch(item: RawSearchItem, now: number) {
	if (item.isPremium !== true)
		return false
	const freeUntil = typeof item.meta?.paywall?.freeUntil === 'string' ? Date.parse(item.meta.paywall.freeUntil) : Number.NaN
	return !(freeUntil > now)
}

/**
 * `GET /search` 的一条 → SearchHit。core 每条都带整篇 `text` / `content`，这里只挑列表要的字段。
 * 片段与命中词是 core 从正文里截的，按纯文本显示。
 *
 * 付费文章不给正文片段，换成公开的摘要；只在正文里命中（标题、摘要里都没有这个词）的整条不列——
 * 否则「搜得到」本身就能用来一个词一个词地试探付费内容
 */
export function searchHitFrom(item: RawSearchItem, now = Date.now()): SearchHit | undefined {
	const type = item.type && SEARCH_TYPES.has(item.type) ? item.type as SearchHitType : undefined
	const path = type && contentPath(type, item)
	if (!type || !path || !item.id)
		return undefined
	const keywords = Array.isArray(item.highlight?.keywords)
		? (item.highlight.keywords as unknown[]).filter((k): k is string => typeof k === 'string' && k.length > 0).slice(0, 10)
		: []
	let snippet = item.highlight?.snippet?.trim() || undefined
	if (lockedForSearch(item, now)) {
		const summary = item.summary?.trim() || undefined
		const visible = `${item.title ?? ''}\n${summary ?? ''}`.toLowerCase()
		if (snippet && !keywords.some(keyword => visible.includes(keyword.toLowerCase())))
			return undefined
		snippet = summary
	}
	return {
		type,
		id: item.id,
		title: item.title ?? '',
		path,
		snippet,
		keywords,
		date: item.createdAt ?? '',
		category: type === 'post' ? item.category?.name : undefined,
	}
}

/** 只列用得到的字段：时间线里的日记还带着位置与经纬度（core 没置空），一概不取 */
interface RawTimelineNote {
	id: string
	nid: number
	title: string
	createdAt: string
	hasPassword?: boolean
	isPublished?: boolean
	bookmark?: boolean
	readCount?: number
	topic?: { name?: string } | null
	mood?: string | null
	weather?: string | null
}

function countOf(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** `GET /aggregate/timeline` → 文章与日记混排，新的在前 */
export function timelineFrom(data: { posts?: PostModel[], notes?: RawTimelineNote[] }): TimelineEntry[] {
	const posts = (data.posts ?? []).map((post): TimelineEntry => ({
		type: 'post',
		id: post.id,
		title: post.title,
		path: `/posts/${post.category?.slug}/${post.slug}`,
		date: post.createdAt,
		category: post.category?.name,
		tags: post.tags ?? [],
		readCount: countOf(post.readCount),
	}))
	// 与日记列表一致：加密的、未发布的不出现
	const notes = (data.notes ?? [])
		.filter(note => !note.hasPassword && note.isPublished !== false)
		.map((note): TimelineEntry => ({
			type: 'note',
			id: note.id,
			title: note.title,
			path: `/notes/${note.nid}`,
			date: note.createdAt,
			category: note.topic?.name || undefined,
			tags: [],
			bookmark: note.bookmark === true || undefined,
			readCount: countOf(note.readCount),
			mood: plainText(note.mood, 20),
			weather: plainText(note.weather, 20),
		}))
	return [...posts, ...notes].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
}

export function projectFromModel(project: ProjectModel): ProjectProps {
	return {
		id: project.id,
		name: project.name,
		description: project.description ?? '',
		avatar: safeUrl(project.avatar),
		links: {
			project: safeUrl(project.projectUrl),
			preview: safeUrl(project.previewUrl),
			doc: safeUrl(project.docUrl),
		},
	}
}

/** core 的 `LinkState`：0 通过、1 待审核、2 失联、3 封禁、4 拒绝 */
const LINK_OUTDATED = 2
const LINK_VISIBLE_STATES = new Set([0, LINK_OUTDATED])

function feedEntryFrom(link: LinkModel): FeedEntry | undefined {
	const url = safeUrl(link.url)
	if (!url)
		return undefined
	// avatar 只校验「是网址」，javascript: 也能存进去
	const avatar = safeUrl(link.avatar)
	return {
		author: link.name,
		link: url,
		avatar,
		icon: avatar,
		desc: link.description || undefined,
		date: link.createdAt?.slice(0, 10),
		error: link.state === LINK_OUTDATED ? msg('site.temporarilyUnreachable') : undefined,
	}
}

/**
 * `GET /links/all` → 友链页的分组。它会返回「封禁」的，这里滤掉；「失联」的照常显示、标成不可访问
 */
export function linkGroupsFrom(links: LinkModel[]): FeedGroup[] {
	const visible = links.filter(link => LINK_VISIBLE_STATES.has(link.state))
	const groups: FeedGroup[] = [
		{ name: msg('common.friends'), desc: msg('site.sitesHaveExchanged'), entries: [] },
		{ name: msg('site.bookmarks'), desc: msg('site.sitesWorthVisiting'), entries: [] },
	]
	for (const link of visible) {
		const entry = feedEntryFrom(link)
		if (entry)
			groups[link.type === 1 ? 1 : 0]!.entries.push(entry)
	}
	return groups.filter(group => group.entries.length)
}

const LINK_BANNED = 3
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu

/**
 * 被站长封禁的友链：只给名称（纯文本、40 字内），链接、头像、描述一概不给。
 * 封禁多半是对方站点变质了（广告、恶意跳转），头像地址也可能是追踪像素
 */
export function bannedLinkNamesFrom(links: LinkModel[]): string[] {
	return links
		.filter(link => link.state === LINK_BANNED)
		.map(link => (typeof link.name === 'string' ? link.name.replace(CONTROL_CHARS, '').trim().slice(0, 40) : ''))
		.filter(Boolean)
}

/** 独立页 → 文章页的头部字段。独立页没有分类和标签 */
export function articleFromPage(page: PageModel): ArticleProps {
	const meta = (page.meta ?? {}) as Record<string, unknown>
	return {
		title: page.title,
		description: page.subtitle || undefined,
		date: page.createdAt,
		updated: page.modifiedAt || undefined,
		published: page.createdAt,
		categories: undefined,
		tags: [],
		type: ARTICLE_TYPES[0] as ArticleProps['type'],
		image: safeUrl(meta.cover),
		readingTime: readingTimeOf(page.text ?? ''),
		path: `/${encodeURIComponent(page.slug)}`,
		meta: { ...meta, __id: page.id },
	}
}

/** `/aggregate/sitemap` 的网址带着 mx 的 `url.webUrl`，只取路径，站点域名交给 @nuxtjs/sitemap */
export function sitemapEntriesFrom(items: { url?: string, publishedAt?: string | null }[]) {
	return items.flatMap((item) => {
		let path: string
		try {
			path = new URL(item.url ?? '').pathname
		}
		catch {
			return []
		}
		return path.startsWith('/') ? [{ loc: path, lastmod: item.publishedAt || undefined }] : []
	})
}

// ———————————————————————————— 站点配置 ————————————————————————————

/** blog.config.ts 的静态值：core 完全不可用时的最后一级兜底 */
export function staticSiteConfig(): SiteConfig {
	return {
		source: 'static',
		title: blogConfig.title,
		description: blogConfig.description,
		keywords: [],
		icon: blogConfig.favicon,
		iconDark: blogConfig.favicon,
		author: {
			name: blogConfig.author.name,
			avatar: blogConfig.author.avatar,
		},
		webUrl: blogConfig.url,
		serverUrl: '',
		social: [],
		introduce: '',
		// core 不可用时评论也加载不了
		comments: { enabled: false, allowGuest: false },
	}
}

function seoFields(seo: SeoOptionModel | undefined, fallback: SiteConfig) {
	const icon = seo?.icon || fallback.icon
	return {
		title: seo?.title || fallback.title,
		description: seo?.description || fallback.description,
		keywords: seo?.keywords ?? [],
		icon,
		iconDark: seo?.iconDark || icon,
	}
}

const SOCIAL_ID = /^[\w.-]{1,64}$/
const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/

/** 认得的社交平台：键 → 图标、名字、按账号拼地址。不直接用站长填的值当地址 */
const SOCIAL_PLATFORMS: Record<string, { icon: string, text: string, url: (id: string) => string }> = {
	github: { icon: 'tabler:brand-github', text: 'GitHub', url: id => `https://github.com/${id}` },
	x: { icon: 'tabler:brand-x', text: 'X', url: id => `https://x.com/${id}` },
	twitter: { icon: 'tabler:brand-x', text: 'X', url: id => `https://x.com/${id}` },
	bilibili: { icon: 'tabler:brand-bilibili', text: msg('site.bilibili'), url: id => `https://space.bilibili.com/${id}` },
	zhihu: { icon: 'tabler:brand-zhihu', text: msg('site.zhihu'), url: id => `https://www.zhihu.com/people/${id}` },
	weibo: { icon: 'tabler:brand-weibo', text: msg('site.weibo'), url: id => `https://weibo.com/${id}` },
	telegram: { icon: 'tabler:brand-telegram', text: 'Telegram', url: id => `https://t.me/${id}` },
	douban: { icon: 'tabler:brand-douban', text: msg('site.douban'), url: id => `https://www.douban.com/people/${id}` },
	instagram: { icon: 'tabler:brand-instagram', text: 'Instagram', url: id => `https://www.instagram.com/${id}` },
	steam: { icon: 'tabler:brand-steam', text: 'Steam', url: id => `https://steamcommunity.com/id/${id}` },
	youtube: { icon: 'tabler:brand-youtube', text: 'YouTube', url: id => `https://www.youtube.com/@${id}` },
}

/**
 * 站长资料的 `socialIds`（键值都由站长填）→ 侧栏图标链接。只认上面几个平台，账号只收字母数字与 `._-`
 * （开头的 @ 去掉），邮箱另验；认不出的键跳过
 */
export function socialLinksOf(socialIds: unknown): SiteConfig['social'] {
	if (typeof socialIds !== 'object' || socialIds === null || Array.isArray(socialIds))
		return []
	return Object.entries(socialIds as Record<string, unknown>).flatMap(([key, raw]) => {
		const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
		const name = key.toLowerCase()
		if ((name === 'mail' || name === 'email') && EMAIL.test(value))
			return [{ icon: 'tabler:mail', text: msg('common.email'), url: `mailto:${value}` }]
		const platform = SOCIAL_PLATFORMS[name]
		const id = value.replace(/^@/, '')
		return platform && SOCIAL_ID.test(id) ? [{ icon: platform.icon, text: platform.text, url: platform.url(id) }] : []
	}).slice(0, 12)
}

/**
 * `GET /aggregate` → SiteConfig。
 * 注意：公开的 `/aggregate` 会带站长的 `user.mail` / `user.email`，这里刻意不映射。
 */
export function siteConfigFromAggregate(data: AggregateRootWithTheme<Record<string, unknown>>): SiteConfig {
	const fallback = staticSiteConfig()
	return {
		source: 'aggregate',
		...seoFields(data.seo, fallback),
		author: {
			name: data.user?.name || fallback.author.name,
			avatar: data.user?.avatar || fallback.author.avatar,
		},
		webUrl: data.url?.webUrl || fallback.webUrl,
		serverUrl: safeUrl(data.url?.serverUrl) ?? '',
		social: socialLinksOf((data.user as { socialIds?: unknown } | undefined)?.socialIds),
		introduce: plainText((data.user as { introduce?: unknown } | undefined)?.introduce, 100) ?? '',
		comments: {
			enabled: !data.commentOptions?.disableComment,
			allowGuest: Boolean(data.commentOptions?.allowGuestComment),
		},
	}
}

/** `GET /aggregate/site` → SiteConfig。它没有头像与评论设置：头像取 `/owner` 的（有的话），其余取静态值 */
export function siteConfigFromSiteInfo(data: AggregateSiteInfo, owner?: { name?: string, avatar?: string }): SiteConfig {
	const fallback = staticSiteConfig()
	return {
		...fallback,
		source: 'site',
		...seoFields(data.seo, fallback),
		author: {
			name: data.user?.name || owner?.name || fallback.author.name,
			avatar: safeUrl(owner?.avatar) || fallback.author.avatar,
		},
		webUrl: data.url?.webUrl || fallback.webUrl,
		serverUrl: safeUrl((data.url as { serverUrl?: string } | undefined)?.serverUrl) ?? '',
		social: socialLinksOf((data.user as { socialIds?: unknown } | undefined)?.socialIds),
		// 拿不到评论设置，按 core 的默认（开启、允许匿名）。没有日记的站点会一直走到这里，
		// 按「不许匿名」处理就等于关掉评论；站长关了匿名评论时，发送会被 core 拒绝并提示登录
		comments: { enabled: true, allowGuest: true },
	}
}

/**
 * `$meta.translation`（按文章 id 索引）→ 这一篇是不是 AI 译文、原文是什么语言。
 * 站点请求一律带 `?lang=zh`，开了 AI 翻译时，非中文的原文会被换成中文译文，页面据此说明并给出看原文的入口
 */
export function translationOf(meta: unknown, id: string | undefined): ContentTranslation | undefined {
	const languages = languagesOf(meta, id)
	return languages?.translated && languages.sourceLang && languages.sourceLang !== SITE_LANG_CODE ? { sourceLang: languages.sourceLang } : undefined
}

/**
 * `$meta.translation` → 这一篇的语言：详情里 core 总会给这一项（`isTranslated` 可能为假）。
 * 语言代码都照 core 的规则折成两字母，认不出的丢掉
 */
/** `$meta.glossary.tags`（带 `?lang=` 取时 core 给的标签译名）→ 原名 → 译名；只收非空、不太长的字符串 */
export function tagGlossaryOf(meta: unknown): Record<string, string> {
	const tags = (meta as { glossary?: { tags?: unknown } } | undefined)?.glossary?.tags
	const out: Record<string, string> = {}
	for (const entry of Array.isArray(tags) ? tags.slice(0, 1000) : []) {
		const { source, translated } = (entry ?? {}) as { source?: unknown, translated?: unknown }
		if (typeof source === 'string' && typeof translated === 'string' && source && translated.trim() && translated.length <= 80)
			out[source] = translated.trim()
	}
	return out
}

/** 一篇文章用到的标签里有译名的那部分；一个都没有时不给 */
export function tagNamesOf(tags: string[] | undefined, glossary: Record<string, string>) {
	const names = Object.fromEntries((tags ?? []).filter(tag => Object.hasOwn(glossary, tag)).map(tag => [tag, glossary[tag]!]))
	return Object.keys(names).length ? names : undefined
}

export function languagesOf(meta: unknown, id: string | undefined): ContentLanguages | undefined {
	const entry = id ? (meta as { translation?: Record<string, { article?: { isTranslated?: unknown, sourceLang?: unknown, availableTranslations?: unknown } }> } | undefined)?.translation?.[id]?.article : undefined
	if (!entry)
		return undefined
	const available = Array.isArray(entry.availableTranslations) ? [...new Set(entry.availableTranslations.map(langCodeOf).filter((code): code is string => Boolean(code)))] : []
	const sourceLang = langCodeOf(entry.sourceLang)
	return { translated: entry.isTranslated === true, available, ...(sourceLang ? { sourceLang } : {}) }
}
