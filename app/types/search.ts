/**
 * 搜索结果的本地类型。core 的每条结果都带整篇正文，映射时已丢掉，这里只有列表要显示的字段。
 */

export type SearchHitType = 'post' | 'note' | 'page'

export interface SearchHit {
	type: SearchHitType
	id: string
	title: string
	path: string
	/** core 截好的正文片段（纯文本）；只命中标题时没有 */
	snippet?: string
	/** 命中的词，组件据此高亮 */
	keywords: string[]
	date: string
	/** 文章的分类名 */
	category?: string
}

export interface SearchPage {
	items: SearchHit[]
	page: number
	totalPages: number
	total: number
}
