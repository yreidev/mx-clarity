/**
 * AI 朗读（core 的 `GET /ai/tts/article/:id`，只读，从不生成）。纯模块，浏览器直连 core 时调用。
 * 只下发每段的文字与音频地址（https 或本站路径）；模型、音色不给访客
 */
import type { TtsSegment } from '../../types/insights'
import type { MxClient } from './client'
import { BLOCK_ID } from './anchor'
import { plainOf } from './rich-blocks'

export function ttsSegmentsFrom(raw: unknown): TtsSegment[] {
	const segments = (raw as { segments?: unknown } | null)?.segments
	return (Array.isArray(segments) ? segments : []).flatMap((segment): TtsSegment[] => {
		const url = typeof segment?.url === 'string' ? segment.url : ''
		const safe = /^https:\/\/[^\s"'<>]{1,2000}$/i.test(url) || /^\/(?!\/)[^\s"'<>]{1,2000}$/.test(url)
		const blockId = typeof segment?.blockId === 'string' && BLOCK_ID.test(segment.blockId) ? segment.blockId : undefined
		return safe ? [{ text: plainOf(segment.text, 2000), url, ...(blockId ? { blockId } : {}) }] : []
	}).slice(0, 2000)
}

/** 按哪种语言取由 client 的 `lang` 决定（适配器把它放在查询参数最后，调用方传的会被盖掉） */
export async function loadTts(client: MxClient, id: string) {
	return ttsSegmentsFrom(await client.ai.getTts({ articleId: id }))
}
