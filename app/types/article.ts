import type { MDCRoot, Toc } from '@nuxtjs/mdc'
import type blogConfig from '~~/blog.config'
import type { ArticlePaywall } from './membership'

// app.config 的 article 就是 blog.config 展开过去的；不用 nuxt/schema 的 AppConfig，这个类型 server 端也要用
export type ArticleOrderType = keyof typeof blogConfig.article.order

type ArticleType = keyof typeof blogConfig.article.types

/** 阅读时间，字段与上游用的 reading-time 一致 */
export interface ReadingTime {
	text: string
	minutes: number
	time: number
	words: number
}

/**
 * 文章的头部字段。原先是 content.config.ts 里 Nuxt Content 的 frontmatter 结构，
 * 原先由 Nuxt Content 生成，移除它时搬到这里，字段名不变，组件照旧用
 */
export interface ArticleSchema {
	title?: string
	description?: string
	date?: string
	updated?: string
	published?: string
	categories?: string[]
	tags?: string[]
	type?: ArticleType

	image?: string
	recommend?: number
	references?: { title?: string, link?: string }[]
	draft?: boolean
	permalink?: string

	readingTime?: ReadingTime
}

/** mx 在入库时算好的图片元数据（宽高、主色），做占位图与防布局偏移时用 */
export interface ArticleImage {
	src: string
	width?: number
	height?: number
	type?: string
	accent?: string
	thumbhash?: string
}

export interface ArticleProps extends ArticleSchema {
	path: string
	/** mx 的累计阅读次数，靠详情页上报 `/ack` 增长 */
	readCount?: number
	/** mx 的赞数 */
	likeCount?: number
	/** 付费文章。列表接口对所有人截断正文，这种文章的字数只按预览算，不准 */
	premium?: boolean
	/** core 每篇文章的「版权」开关；为假时文末不显示许可协议一栏 */
	copyright?: boolean
	/** 前缀版的列表里：这一篇拿到的是 AI 译文（卡片上加小标） */
	translated?: boolean
	/** 前缀版里标签的译名（core 的 `$meta.glossary.tags`）：原名 → 译名；链接照旧按原名 */
	tagNames?: Record<string, string>

	meta?: {
		coverDim?: boolean
		coverFilter?: string
		hideInfo?: boolean
		/** 侧栏挂件，mx 的 `post.meta.aside` */
		aside?: string[]
		/** mx 的文章 id，评论与点赞按它提交 */
		__id?: string
		/** 封面图的完整元数据 */
		__image?: ArticleImage
		/** mx 的 `post.meta` 其余字段原样透传 */
		[key: string]: unknown
	}
}

/** 正文是 core 的 AI 译文时：原文的语言代码（如 `en`） */
export interface ContentTranslation {
	sourceLang: string
}

/** 这一篇的语言（core 的 `$meta.translation`）：这次拿到的是不是译文、原文语言、有哪些有效译文 */
export interface ContentLanguages {
	translated: boolean
	/** 原文的语言（两字母）；一篇没有任何译文记录时 core 给不出，是空的 */
	sourceLang?: string
	/** 有效译文的语言（两字母，没按主题配置过滤） */
	available: string[]
}

/** 顶部公告的样式：core 的 banner 预设五种，对到提示框组件的四种样式 */
export type BannerType = 'info' | 'tip' | 'warning' | 'error'

/**
 * 文章与日记详情的附加信息：服务端从 `meta`（admin 里的预设）与 core 的 `$meta` 整理好，页面只管显示。
 * 字段都已净化：文字是纯文本、地址过了白名单
 */
export interface ContentExtras {
	/** 顶部公告（meta.banner） */
	banner?: { type: BannerType, message: string }
	/** AI 参与声明（meta.aiGen）：`handcrafted` 纯手写；`full` 全文由 AI 生成 */
	aiGen?: { labels: string[], handcrafted: boolean, full: boolean }
	/** core 生成的 AI 摘要（$meta.summary）；付费文章锁着时没有 */
	aiSummary?: string
	/** 站长手动关联的文章（$meta.related） */
	related?: { title: string, path: string, summary?: string }[]
	/** 文章附带的 Skill 包（$meta.skills） */
	skills?: { name: string, description: string, url?: string }[]
	/** 有 AI 洞察（$meta.insights.hasInLocale）；锁定的付费文章、解锁进来的加密日记不带 */
	insights?: boolean
	/** 有 AI 朗读（$meta.tts.available）；`stale` 是朗读版本早于最近的修改 */
	tts?: { stale: boolean }
}

/** 文章详情页的数据：`/api/mx/posts/:category/:slug` 的返回 */
export interface ArticleDetail {
	article: ArticleProps
	/** 渲染好的正文 AST：Lexical 文章走路径 A，其余走路径 B */
	body: MDCRoot
	toc?: Toc
	/** 实际走了哪条路径 */
	source: 'lexical' | 'markdown'
	/** 正文是 core 的 AI 译文（原文不是中文）：原文的语言 */
	translation?: ContentTranslation
	languages?: ContentLanguages
	/** 付费文章才有；锁定时 `body` 只是 core 截好的预览 */
	paywall?: ArticlePaywall
	extras?: ContentExtras
}
