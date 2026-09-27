/**
 * AI 洞察（精读）。纯模块，由 server 路由调用。
 *
 * - 取法只有 `getInsights({ onlyDb: true })`：库里没有就是没有，**绝不**让 core 当场生成（那会花站长的模型费用，
 *   而且 `/generate` 与不带 onlyDb 的请求对任何访客都开放）；
 * - 内容是 AI 生成的 markdown，按半可信处理：走路径 B 的渲染与白名单；
 * - `<ref quote="…" section="…"/>` 是「跳回原文」的引用：解析 markdown 之前换成占位，渲染后再换成 `insight-ref` 元素，
 *   不交给 mdc 去认这个标签；末尾的 `<!-- insights-meta: {...} -->` 去掉，只取阅读时长与难度
 */
import type { MDCElement, MDCNode } from '@nuxtjs/mdc'
import type { InsightsResult } from '../../types/insights'
import type { MxClient } from './client'
import { renderMarkdownBody } from './body'
import { classifyMxError } from './errors'
import { plainOf } from './rich-blocks'

const META = /<!--\s*insights-meta:\s*(\{[^\n]*?\})\s*-->/g
const REF = /<ref\s([^<>]*)>/g
const ATTRIBUTE = /(\w+)\s*=\s*"([^"]*)"/g
const PLACEHOLDER = /\uE000(\d{1,3})\uE001/g
const DIFFICULTIES = new Set(['easy', 'medium', 'hard'])

function unescapeXml(value: string) {
	return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
}

/** 内容 → 去掉 meta 注释、引用换成占位的 markdown，外加引用列表与 meta */
export function parseInsightsContent(content: string) {
	let meta: InsightsResult['meta'] = {}
	const metas = [...content.matchAll(META)]
	const last = metas.at(-1)
	if (last) {
		try {
			const raw = JSON.parse(last[1]!) as Record<string, unknown>
			const minutes = raw.reading_time_min
			meta = {
				readingMinutes: Number.isInteger(minutes) && (minutes as number) > 0 && (minutes as number) < 1000 ? minutes as number : undefined,
				difficulty: DIFFICULTIES.has(raw.difficulty as string) ? raw.difficulty as 'easy' | 'medium' | 'hard' : undefined,
			}
		}
		catch {}
	}
	const refs: { quote: string, section?: string }[] = []
	const markdown = content.replace(META, '').replace(REF, (_, attributes: string) => {
		const values: Record<string, string> = {}
		for (const [, name, value] of attributes.matchAll(ATTRIBUTE))
			values[name!] = unescapeXml(value!)
		const quote = plainOf(values.quote, 120)
		if (!quote || refs.length >= 200)
			return ''
		refs.push({ quote, section: plainOf(values.section, 40) || undefined })
		return `\uE000${refs.length - 1}\uE001`
	})
	return { markdown, refs, meta }
}

/** 渲染后的文本节点里把占位换回 `insight-ref`；代码块里的、找不到的占位直接去掉 */
function restoreRefs(nodes: MDCNode[] = [], refs: { quote: string, section?: string }[]): MDCNode[] {
	return nodes.flatMap((node): MDCNode[] => {
		if (node.type === 'text') {
			const parts: MDCNode[] = []
			let last = 0
			for (const match of node.value.matchAll(PLACEHOLDER)) {
				if (match.index > last)
					parts.push({ type: 'text', value: node.value.slice(last, match.index) })
				const ref = refs[Number(match[1])]
				if (ref)
					parts.push({ type: 'element', tag: 'insight-ref', props: { quote: ref.quote, ...(ref.section ? { section: ref.section } : {}) }, children: [] } satisfies MDCElement)
				last = match.index + match[0].length
			}
			if (last < node.value.length)
				parts.push({ type: 'text', value: node.value.slice(last) })
			return last ? parts : [node]
		}
		if (node.type !== 'element')
			return [node]
		const props = { ...node.props }
		if (typeof props.code === 'string')
			props.code = props.code.replace(PLACEHOLDER, '')
		return [{ ...node, props, children: restoreRefs(node.children, refs) }]
	})
}

export async function renderInsights(content: string) {
	const { markdown, refs, meta } = parseInsightsContent(content)
	const { body } = await renderMarkdownBody(markdown)
	body.children = restoreRefs(body.children, refs)
	return { body, meta }
}

/**
 * 取一篇的洞察（`id` 是文章或日记的 id）。库里没有、正文改过（hash 对不上）时 core 回 null；
 * 付费文章锁定时 403，不可见时 400：都返回对应的状态，不透传 core 的文案
 */
export async function loadInsights(client: MxClient, id: string): Promise<InsightsResult> {
	let raw: unknown
	try {
		raw = await client.ai.getInsights({ articleId: id, onlyDb: true })
	}
	catch (error) {
		const failure = classifyMxError(error)
		if (failure.status === 403)
			return { status: 'locked' }
		if (failure.status === 400 || failure.kind === 'not-found')
			return { status: 'none' }
		throw error
	}
	const content = (raw as { content?: unknown } | null)?.content
	if (typeof content !== 'string' || !content.trim())
		return { status: 'none' }
	const { body, meta } = await renderInsights(content.slice(0, 200_000))
	return { status: 'ready', body, meta, translated: (raw as { isTranslation?: unknown }).isTranslation === true }
}
