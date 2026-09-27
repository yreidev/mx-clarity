/** 时间线：文章与日记按时间混排 */

export interface TimelineEntry {
	type: 'post' | 'note'
	id: string
	title: string
	path: string
	date: string
	/** 文章是分类名，日记是专栏名 */
	category?: string
	tags: string[]
	/** 日记的「回忆」标记（站长标出来的） */
	bookmark?: boolean
	/** 累计阅读次数 */
	readCount?: number
	/** 日记的心情与天气（纯文本） */
	mood?: string
	weather?: string
}
