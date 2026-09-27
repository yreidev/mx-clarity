import type { MDCRoot } from '@nuxtjs/mdc'

/** AI 洞察（精读）：`ready` 有内容；`none` 还没生成或正文改过；`locked` 付费文章要解锁才能读 */
export type InsightsResult
	= | { status: 'ready', body: MDCRoot, meta: { readingMinutes?: number, difficulty?: 'easy' | 'medium' | 'hard' }, translated: boolean }
		| { status: 'none', body?: undefined, meta?: undefined }
		| { status: 'locked', body?: undefined, meta?: undefined }

/** 朗读的一段：纯文本、音频地址，以及它读的是正文哪一块（core 的块 id，逐段高亮用） */
export interface TtsSegment {
	text: string
	url: string
	blockId?: string
}
