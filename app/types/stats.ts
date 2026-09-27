/** 统计挂件的数据：全部由主题缓存的公开文章与日记算出，不含草稿、加密与定时公开的内容 */

export interface BlogStats {
	total: {
		posts: number
		notes: number
		/** 公开文章的字数（付费文章按预览算，偏小） */
		words: number
		/** 公开文章的累计阅读与点赞 */
		reads: number
		likes: number
	}
	/** 每年的文章数与字数，键是年份 */
	annual: Record<string, { posts: number, words: number }>
	/** 最近一篇文章的更新时间 */
	updated?: string
	/** 最早一篇公开文章或日记的时间（主题配置没填建站日期时，「运营时长」从它算） */
	firstPublished?: string
}

/** 上次来访之后的新内容 */
export interface SiteUpdates {
	count: number
	/** 最新的几篇，新的在前 */
	items: { title: string, path: string, date: string }[]
}
