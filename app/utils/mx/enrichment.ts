/**
 * 链接卡片的数据：core 的 `$meta.enrichments`（碎碎念是每条的 `enrichments`）。纯模块，只在服务端用。
 *
 * 条目里几乎全是第三方给的（Open Graph 抓来的标题、描述、图片、`url`），一律零信任：
 * - 只取文字：标题、描述、站名、几项属性（中文标签），**不带任何图片**（第三方图片会拿到读者 IP，你定了只显示文字）；
 * - 条目里的 `url` 可以是 `javascript:` 或任意主机，**不用**：链接永远是作者写的网址；
 * - `color` 是任意字符串，只收 `#rrggbb`；
 * - 站内卡片（self）只给标题与类型：core 的 `note-date:` 分支疑似会把加密日记的正文放进描述。
 * 净化后的卡片按网址（作者原串与 `new URL().href` 规整后的）查，渲染后的正文里再补进 `link-card`
 */
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import type { UiLang } from '~~/shared/utils/i18n'
import { localeOf, msg, translate } from '~~/shared/utils/i18n'
import { normalizedUrl, plainOf } from './rich-blocks'

export interface LinkPreview {
	title: string
	description?: string
	site?: string
	kind: string
	/** 属性，已格式化成「标签：值」，最多 4 项 */
	facts: string[]
	accent?: string
}

export type PreviewLookup = (url: string) => LinkPreview | undefined

const KINDS = new Set(['github', 'media', 'academic', 'code', 'self', 'music', 'book', 'web'])
const ACCENT = /^#[\da-f]{6}$/i
const FACT_LABELS: Record<string, string> = {
	stars: msg('content.stars'),
	forks: msg('content.forks'),
	language: msg('common.language'),
	license: msg('content.license'),
	state: msg('content.status'),
	author: msg('content.author'),
	rating: msg('content.rating'),
	votes: msg('content.ratings'),
	difficulty: msg('content.difficulty'),
	acceptance: msg('content.acceptance'),
	artist: msg('content.artist'),
	album: msg('content.album'),
	genres: msg('content.genres'),
	comments: msg('content.comments'),
	number: msg('content.number'),
	repo: msg('content.repository'),
	additions: msg('content.additions'),
	deletions: msg('content.deletions'),
	merged: msg('content.merged'),
	isbn: 'ISBN',
	section: msg('content.section'),
}

function factOf(attribute: unknown, ui: UiLang): string | undefined {
	if (typeof attribute !== 'object' || attribute === null)
		return undefined
	const { key, value, format } = attribute as { key?: unknown, value?: unknown, format?: unknown }
	const label = typeof key === 'string' && FACT_LABELS[key] ? translate(ui, FACT_LABELS[key]) : undefined
	if (!label)
		return undefined
	let text: string
	if (typeof value === 'boolean')
		text = value ? translate(ui, 'content.yes') : translate(ui, 'content.no')
	else if (typeof value === 'number' && Number.isFinite(value))
		text = format === 'rating' ? value.toFixed(1) : format === 'percent' ? `${(value <= 1 ? value * 100 : value).toFixed(1)}%` : value.toLocaleString(localeOf(ui))
	else if (typeof value === 'string')
		text = format === 'date' ? value.slice(0, 10) : value
	else
		return undefined
	const plain = plainOf(text, 40)
	return plain ? translate(ui, 'content.factLine', { label, value: plain }) : undefined
}

/** 一个条目 → 卡片；没有标题的不要 */
export function linkPreviewOf(entry: unknown, ui: UiLang = 'zh'): LinkPreview | undefined {
	if (typeof entry !== 'object' || entry === null)
		return undefined
	const raw = entry as { title?: unknown, description?: unknown, category?: unknown, subtype?: unknown, attributes?: unknown, color?: unknown }
	const title = plainOf(raw.title, 120)
	if (!title)
		return undefined
	const kind = typeof raw.category === 'string' && KINDS.has(raw.category) ? raw.category : 'web'
	const attributes = Array.isArray(raw.attributes) ? raw.attributes : []
	if (kind === 'self')
		return { title, kind, facts: [], description: raw.subtype === 'note' ? translate(ui, 'content.diaryEntrySite') : translate(ui, 'content.postSite') }
	const site = attributes.find(item => (item as { key?: unknown })?.key === 'site') as { value?: unknown } | undefined
	const preview: LinkPreview = {
		title,
		kind,
		facts: attributes.map(attribute => factOf(attribute, ui)).filter((fact): fact is string => Boolean(fact)).slice(0, 4),
	}
	const description = plainOf(raw.description, 240)
	if (description)
		preview.description = description
	const siteName = plainOf(site?.value, 60)
	if (siteName)
		preview.site = siteName
	if (typeof raw.color === 'string' && ACCENT.test(raw.color))
		preview.accent = raw.color
	return preview
}

/** `enrichments` 映射 → 查卡片的函数：先按作者原串（trim）查，再按规整后的地址查 */
export function previewLookupOf(enrichments: unknown, ui: UiLang = 'zh'): PreviewLookup | undefined {
	if (typeof enrichments !== 'object' || enrichments === null || Array.isArray(enrichments))
		return undefined
	const exact = new Map<string, LinkPreview>()
	const normalized = new Map<string, LinkPreview>()
	for (const [key, entry] of Object.entries(enrichments as Record<string, unknown>).slice(0, 200)) {
		const preview = linkPreviewOf(entry, ui)
		if (!preview)
			continue
		exact.set(key.trim(), preview)
		const href = normalizedUrl(key)
		if (href)
			normalized.set(href, preview)
	}
	if (!exact.size)
		return undefined
	return url => exact.get(url.trim()) ?? normalized.get(normalizedUrl(url) ?? '')
}

function cardProps(preview: LinkPreview) {
	const props: Record<string, unknown> = { title: preview.title, kind: preview.kind }
	if (preview.description)
		props.description = preview.description
	if (preview.site)
		props.site = preview.site
	// 字符串数组会被 MDCRenderer 用空格拼起来，序列化成 JSON 字符串
	if (preview.facts.length)
		props.facts = JSON.stringify(preview.facts)
	if (preview.accent)
		props.accent = preview.accent
	return props
}

function textOf(node: MDCNode): string {
	if (node.type === 'text')
		return node.value
	return node.type === 'element' ? (node.children ?? []).map(textOf).join('') : ''
}

/** 段落里只有一个链接、链接文字就是网址（自动链接、单独贴的网址）时返回这个链接 */
export function soleUrlLink(paragraph: MDCElement): MDCElement | undefined {
	const meaningful = (paragraph.children ?? []).filter(child => !(child.type === 'text' && !child.value.trim()))
	const [only] = meaningful
	if (meaningful.length !== 1 || only?.type !== 'element' || only.tag !== 'a')
		return undefined
	const href = only.props?.href
	if (typeof href !== 'string')
		return undefined
	const text = textOf(only).trim()
	return text === href || (normalizedUrl(text) && normalizedUrl(text) === normalizedUrl(href)) ? only : undefined
}

/**
 * 渲染好的正文里补上链接卡片（两条渲染路径、碎碎念共用）：
 * - `link-card`：查到条目就换成条目的文字（链接照旧是节点上的）；
 * - 只有一个「文字就是网址」的链接的段落：查到条目就换成 `link-card`，查不到照旧是普通段落。
 * 带自定义文字的单独链接不变卡片（与官方主题一致）。就地修改
 */
export function applyLinkPreviews(body: MDCRoot, lookup: PreviewLookup | undefined) {
	if (!lookup)
		return body
	const walk = (nodes: MDCNode[] = []): MDCNode[] => nodes.map((node) => {
		if (node.type !== 'element')
			return node
		const element = node as MDCElement
		if (element.tag === 'link-card' && typeof element.props?.link === 'string') {
			const preview = lookup(element.props.link)
			if (preview)
				element.props = { link: element.props.link, ...cardProps(preview) }
			return element
		}
		if (element.tag === 'p') {
			const link = soleUrlLink(element)
			const preview = link && lookup(String(link.props!.href))
			if (link && preview)
				return { type: 'element', tag: 'link-card', props: { link: link.props!.href, ...cardProps(preview) }, children: [] } satisfies MDCElement
		}
		element.children = walk(element.children)
		return element
	})
	body.children = walk(body.children)
	return body
}
