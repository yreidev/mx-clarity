/**
 * 日记、专栏、说说、碎碎念的本地类型。页面与组件只认这些，不认 api-client 的模型。
 */
import type { MDCRoot, Toc } from '@nuxtjs/mdc'
import type { ArticleProps, ContentExtras, ContentLanguages, ContentTranslation } from './article'

export interface TopicLink {
	name: string
	slug: string
	/** `/notes/series/:slug` */
	path: string
}

export interface TopicProps extends TopicLink {
	/** 纯文本开头（原文是 markdown，详情页的渲染结果在 TopicDetail.descriptionBody） */
	description: string
	introduce: string
	/** 过了协议白名单 */
	icon?: string
}

/** 专栏详情页：`/api/mx/topics/:slug` 的返回 */
export interface TopicDetail {
	topic: TopicProps
	/** `description` 按 markdown 渲染好的正文（没写描述时没有） */
	descriptionBody?: MDCRoot
	notes: Paged<NoteProps>
}

/** 日记详情侧栏的「前后的日记」：`newer` 比这篇新（近的在前），`older` 比这篇旧（近的在前） */
export interface NoteNeighbors {
	newer: { title: string, path: string, date: string }[]
	older: { title: string, path: string, date: string }[]
}

export interface NoteProps {
	nid: number
	title: string
	date: string
	updated?: string
	mood?: string
	weather?: string
	/** mx 的「回忆标记」 */
	bookmark: boolean
	topic?: TopicLink
	/** 正文的纯文本开头，列表用 */
	excerpt: string
	readingTime: NonNullable<ArticleProps['readingTime']>
	/** 累计阅读次数 */
	readCount: number
	/** 赞数 */
	likeCount: number
	/** `/notes/:nid` */
	path: string
	/** 封面（admin 里的 cover 预设，文章与日记通用），只收 http(s) */
	cover?: string
	/** 前缀版的列表里，这一篇拿到的是 AI 译文（core 的 `$meta.translation`） */
	translated?: boolean
	meta: { __id: string, [key: string]: unknown }
}

export interface NoteLink {
	nid: number
	title: string
	date?: string
	path: string
}

/**
 * 加密日记没带对密码时，core 整篇拒绝（403 `NOTE_FORBIDDEN`），拿不到任何元数据；
 * 定时公开、还没到时间的日记只给公开时间，标题和正文都不下发
 */
export type NoteDetail
	= | {
		locked: false
		note: NoteProps
		body: MDCRoot
		toc?: Toc
		source: 'lexical' | 'markdown'
		/** 更新的一篇（mx 的 `prev`） */
		newer?: NoteLink
		/** 更早的一篇（mx 的 `next`） */
		older?: NoteLink
		/** 正文是 core 的 AI 译文：原文的语言 */
		translation?: ContentTranslation
		languages?: ContentLanguages
		extras?: ContentExtras
	}
	| { locked: true, nid: number }
	| { locked: false, scheduled: true, nid: number, publicAt: string }

export interface SayProps {
	id: string
	text: string
	author?: string
	source?: string
	date: string
}

export interface ThinkingProps {
	id: string
	/** 正文是 markdown，服务端已按路径 B 渲染好 */
	body: MDCRoot
	date: string
	updated?: string
	/** `metadata.url`，过了协议白名单 */
	link?: string
	up: number
	down: number
	/** 能不能评论（详情页才放评论区） */
	allowComment: boolean
	/** `/thinking/:id` */
	path: string
	/**
	 * 引用的文章、日记、独立页或别的碎碎念（core 的 `ref`）；地址只收站内路径。
	 * 不叫 ref：条目用 `v-bind` 整个传给组件，`ref` 在 Vue 模板里是保留属性，传不进 props
	 */
	quoted?: { title: string, path: string, kind: 'post' | 'note' | 'page' | 'thinking' }
	/** 由 companion 发布时附带的情境：当时在用的应用、窗口标题、在放的歌（纯文本） */
	context?: { app?: string, window?: string, media?: string }
	/** 正文开头的纯文本，详情页的标题后缀与描述用 */
	excerpt: string
}

export interface Paged<T> {
	items: T[]
	page: number
	totalPages: number
	total: number
}
