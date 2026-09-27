/**
 * 正文里的富内容块：从 Lexical 节点的字段（零信任）洗出原始类型的属性，交给两条渲染路径共用。纯模块。
 *
 * 规矩：地址一律过协议白名单；数字限范围；文字只当纯文本、限长；属性只放字符串、数字、布尔、数字数组
 * （`sanitizeBody` 会删掉值是对象的属性；MDCRenderer 会把字符串数组用空格拼成一个字符串），
 * 成组的文字序列化成 JSON 字符串，组件按字段取、再校验一次，不整块透传。
 */
import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import type { UiLang } from '~~/shared/utils/i18n'
import { translate } from '~~/shared/utils/i18n'
import { isSafeUrl } from './body'

type Props = Record<string, unknown>

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const CONTROL = /[\p{Cc}\p{Cf}]/gu

/** 纯文本：并掉空白、去掉控制字符、限长 */
export function plainOf(value: unknown, max: number) {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(CONTROL, '').trim().slice(0, max) : ''
}

function safeHref(value: unknown) {
	const url = str(value).trim()
	return url && isSafeUrl(url) ? url : undefined
}

function intIn(value: unknown, min: number, max: number) {
	const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
	return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max ? number : undefined
}

// ———————————————————————————— 图片 ————————————————————————————

const ACCENT = /^#(?:[\da-f]{3}|[\da-f]{6})$/i
const THUMBHASH = /^[A-Z0-9+/]{16,120}={0,2}$/i

/**
 * 图片的元数据（Lexical image 节点、图集项、文档级 images 表共用）：宽高 1–20000 的整数、
 * 主色只收 `#rgb` / `#rrggbb`、thumbhash 只收 16–120 位 base64。不合格的丢掉，不影响图片本身
 */
export function imageMetaOf(source: Record<string, unknown>): Props {
	const props: Props = {}
	const width = intIn(source.width, 1, 20000)
	const height = intIn(source.height, 1, 20000)
	if (width && height) {
		props.width = width
		props.height = height
	}
	if (typeof source.accent === 'string' && ACCENT.test(source.accent))
		props.accent = source.accent
	if (typeof source.thumbhash === 'string' && THUMBHASH.test(source.thumbhash))
		props.thumbhash = source.thumbhash
	return props
}

/** 文档级 `images`（core 给非 Lexical 文档算的）→ 规整后的地址 → 元数据；没有 src 的、过时的都跳过 */
export function imageMetaTableOf(images: unknown): Map<string, Props> {
	const table = new Map<string, Props>()
	for (const image of Array.isArray(images) ? images : []) {
		if (typeof image !== 'object' || image === null)
			continue
		const src = normalizedUrl((image as { src?: unknown }).src)
		const meta = imageMetaOf(image as Record<string, unknown>)
		if (src && Object.keys(meta).length)
			table.set(src, meta)
	}
	return table
}

/** 查表用的规整地址（mdc 会把网址里的非 ASCII 百分号编码，core 记的是原串） */
export function normalizedUrl(value: unknown) {
	if (typeof value !== 'string' || !value.trim())
		return undefined
	try {
		return new URL(value.trim()).href
	}
	catch {
		return undefined
	}
}

/**
 * 路径 B：正文里的 `img` 按文档级 images 表补上宽高、主色、thumbhash（表里是 core 给非 Lexical 文档算的）。
 * 已经写了宽高的不覆盖。就地修改
 */
export function applyImageMeta(body: MDCRoot, table: Map<string, Props>) {
	if (!table.size)
		return body
	const walk = (node: MDCNode) => {
		if (node.type !== 'element')
			return
		const element = node as MDCElement
		if (element.tag === 'img') {
			const meta = table.get(normalizedUrl(element.props?.src) ?? '')
			if (meta) {
				const own = element.props?.width && element.props?.height
				element.props = { ...element.props, ...(own ? { accent: meta.accent, thumbhash: meta.thumbhash } : meta) }
				for (const key of ['accent', 'thumbhash']) {
					if (element.props[key] === undefined)
						delete element.props[key]
				}
			}
		}
		for (const child of element.children ?? [])
			walk(child)
	}
	for (const child of body.children ?? [])
		walk(child)
	return body
}

// ———————————————————————————— 图集 ————————————————————————————

const GALLERY_LAYOUTS = new Set(['grid', 'masonry', 'carousel'])

/** 图集的排版：布局只认三种（别的按 grid），`fit` 只认 cover / contain，最大高度 80–2000 的整数 */
export function galleryPropsOf(node: Record<string, unknown>): Props {
	const props: Props = { layout: GALLERY_LAYOUTS.has(str(node.layout)) ? str(node.layout) : 'grid', fit: str(node.fit) === 'contain' ? 'contain' : 'cover' }
	const maxHeight = intIn(node.maxItemHeight, 80, 2000)
	if (maxHeight)
		props.maxHeight = maxHeight
	return props
}

// ———————————————————————————— 嵌入 ————————————————————————————

const YOUTUBE_ID = /^[\w-]{11}$/
const BVID = /^BV[\dA-Z]{10}$/i

export type EmbedTarget
	= | { kind: 'video', type: 'youtube' | 'bilibili', id: string }
		| { kind: 'link', link: string, title: string }

/**
 * embed 节点：不信它的 `source`，按网址判定。YouTube、B 站的视频交给现有的视频组件（id 按平台格式校验），
 * 其余（GitHub 文件、推特、Gist……）画链接卡片，标题是「主机名 + 路径」。地址不安全时返回 undefined
 */
export function embedTargetOf(value: unknown): EmbedTarget | undefined {
	const link = safeHref(value)
	if (!link)
		return undefined
	let url: URL
	try {
		url = new URL(link)
	}
	catch {
		return { kind: 'link', link, title: link }
	}
	const host = url.hostname.replace(/^(?:www|m)\./, '')
	if (host === 'youtube.com' && url.pathname === '/watch' && YOUTUBE_ID.test(url.searchParams.get('v') ?? ''))
		return { kind: 'video', type: 'youtube', id: url.searchParams.get('v')! }
	if (host === 'youtu.be' && YOUTUBE_ID.test(url.pathname.slice(1)))
		return { kind: 'video', type: 'youtube', id: url.pathname.slice(1) }
	const bvid = url.pathname.match(/^\/video\/(BV[\dA-Z]{10})\/?$/i)?.[1]
	if (host === 'bilibili.com' && bvid && BVID.test(bvid))
		return { kind: 'video', type: 'bilibili', id: bvid }
	let path = url.pathname
	try {
		path = decodeURIComponent(path)
	}
	catch {}
	return { kind: 'link', link, title: `${url.hostname}${path === '/' ? '' : path}`.slice(0, 120) }
}

// ———————————————————————————— 文件 ————————————————————————————

const EXT = /^[a-z\d]{1,10}$/i

/** 字节数 → 「1.2 MB」；不是非负整数时返回空串 */
export function fileSizeText(size: unknown) {
	if (typeof size !== 'number' || !Number.isInteger(size) || size < 0)
		return ''
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	let value = size
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	return `${unit ? value.toFixed(value < 10 ? 1 : 0) : value} ${units[unit]}`
}

/** 文件节点 → 文件卡片的属性；地址不安全时返回 undefined */
export function fileCardPropsOf(node: Record<string, unknown>, ui: UiLang = 'zh'): Props | undefined {
	const src = safeHref(node.src)
	if (!src || !/^(?:https?:\/\/|\/(?!\/))/i.test(src))
		return undefined
	const name = plainOf(node.name, 120) || src.split('/').pop() || translate(ui, 'content.file')
	const extFromName = name.includes('.') ? name.split('.').pop() : ''
	const ext = [str(node.ext), extFromName].find(value => value && EXT.test(value))
	const props: Props = { src, name, inline: str(node.display) === 'inline' }
	if (ext)
		props.ext = ext.toLowerCase()
	const size = fileSizeText(node.size)
	if (size)
		props.size = size
	return props
}

// ———————————————————————————— 画板 ————————————————————————————

const EXCALIDRAW_MAX = 1024 * 1024

/**
 * Excalidraw 画板的摘要：只解析内联 JSON（`{elements}` 或 `{data: {elements}}`），数元素、取文字元素里的文字（最多 20 条）。
 * 远端的、`ref:` 的场景不取；快照超过 1 MB、解析失败都当作没有
 */
export function excalidrawSummaryOf(snapshot: unknown): { count: number, texts: string[] } | undefined {
	if (typeof snapshot !== 'string' || !snapshot.trim().startsWith('{') || snapshot.length > EXCALIDRAW_MAX)
		return undefined
	let scene: unknown
	try {
		scene = JSON.parse(snapshot)
	}
	catch {
		return undefined
	}
	const data = (scene as { data?: unknown })?.data ?? scene
	const elements = (data as { elements?: unknown })?.elements
	if (!Array.isArray(elements))
		return undefined
	const visible = elements.filter(item => typeof item === 'object' && item !== null && (item as { isDeleted?: unknown }).isDeleted !== true)
	const texts = visible
		.filter(item => (item as { type?: unknown }).type === 'text')
		.map(item => plainOf((item as { text?: unknown }).text, 100))
		.filter(Boolean)
		.slice(0, 20)
	return { count: visible.length, texts }
}

// ———————————————————————————— 投票 ————————————————————————————

const POLL_ID = /^p_[\da-z]{1,62}$/i
const OPTION_ID = /^o_[\da-z]{1,62}$/i
const SHOW_RESULTS = new Set(['always', 'after-vote', 'after-close'])

/**
 * poll 节点 → 可投票的 `mx-poll` 的属性（选项序列化成 `[{id, label}]` 的 JSON 字符串）；
 * 投票 id 或任一选项 id 不合 core 的格式时返回 undefined，调用方退回静态列表（core 反正认不出）
 */
export function pollPropsOf(node: Record<string, unknown>, ui: UiLang = 'zh'): Props | undefined {
	const pollId = str(node.pollId).trim()
	const options = (Array.isArray(node.options) ? node.options : []).map(option => ({
		id: str((option as { id?: unknown })?.id).trim(),
		label: plainOf((option as { label?: unknown })?.label, 200),
	}))
	if (!POLL_ID.test(pollId) || !options.length || options.length > 50 || !options.every(option => OPTION_ID.test(option.id)))
		return undefined
	if (new Set(options.map(option => option.id)).size !== options.length)
		return undefined
	const props: Props = {
		pollId,
		question: plainOf(node.question, 300),
		mode: node.mode === 'multiple' ? 'multiple' : 'single',
		options: JSON.stringify(options.map(option => ({ id: option.id, label: option.label || translate(ui, 'content.emptyOption') }))),
	}
	const closeAt = str(node.closeAt).trim()
	if (closeAt && closeAt.length <= 40 && Number.isFinite(Date.parse(closeAt)))
		props.closeAt = closeAt
	if (SHOW_RESULTS.has(str(node.showResults)))
		props.showResults = str(node.showResults)
	return props
}

/**
 * 不能投票的页面（草稿预览、解锁后的加密日记）里把 `mx-poll` 换回静态列表：core 在这些页面里一定找不到这个投票。就地修改
 */
export function staticPolls(body: MDCRoot, ui: UiLang = 'zh') {
	const walk = (nodes: MDCNode[] = []): MDCNode[] => nodes.map((node) => {
		if (node.type !== 'element')
			return node
		const element = node as MDCElement
		if (element.tag === 'mx-poll')
			return staticPollOf(String(element.props?.question ?? ''), pollOptionsOf(element.props?.options).map(option => option.label), translate(ui, 'content.cantVoteHere'))
		element.children = walk(element.children)
		return element
	})
	body.children = walk(body.children)
	return body
}

/** `mx-poll` 的 `options`（JSON 字符串）→ 选项；解析失败或格式不对的项丢掉 */
export function pollOptionsOf(value: unknown): { id: string, label: string }[] {
	try {
		const parsed = JSON.parse(typeof value === 'string' ? value : '[]')
		return Array.isArray(parsed)
			? parsed.filter(option => typeof option?.id === 'string' && OPTION_ID.test(option.id) && typeof option?.label === 'string').slice(0, 50)
			: []
	}
	catch {
		return []
	}
}

/** 投票的静态列表：问题 + 选项 + 一句说明 */
export function staticPollOf(question: string, labels: string[], note: string): MDCElement {
	const text = (value: string): MDCNode => ({ type: 'text', value })
	const element = (tag: string, props: Props, children: MDCNode[]): MDCElement => ({ type: 'element', tag, props, children })
	return element('div', { className: ['mx-poll'] }, [
		element('p', {}, [element('strong', {}, [text(question)])]),
		element('ul', {}, labels.map(label => element('li', {}, [text(label)]))),
		element('p', {}, [element('em', {}, [text(note)])]),
	])
}

// ———————————————————————————— 股票 ————————————————————————————

const SYMBOL = /^[A-Z0-9^][A-Z0-9.:/=^-]{0,19}$/
const INTERVALS: Record<string, number> = { '5m': 60, '15m': 60, '1h': 365, '1d': 3 * 365 }
const DAY = 86_400_000

/**
 * stock 节点 → `stock-block` 的属性。代码只收字母数字与 `.:/=^-`（挡住 `A,B` 这种会被上游当成批量查询的写法）；
 * K 线的粒度只认四种、起止能解析且起在止前、跨度按粒度限制（分钟线 60 天、小时线 1 年、日线 3 年），不合格就当快照
 */
export function stockPropsOf(node: Record<string, unknown>): Props | undefined {
	const symbol = str(node.symbol).trim().toUpperCase()
	if (!SYMBOL.test(symbol))
		return undefined
	const props: Props = { symbol, variant: 'snapshot' }
	const range = typeof node.range === 'object' && node.range !== null ? node.range as Record<string, unknown> : undefined
	const interval = str(range?.interval)
	const from = Date.parse(str(range?.from))
	const to = Date.parse(str(range?.to))
	if (node.variant === 'kline' && INTERVALS[interval] && Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= INTERVALS[interval]! * DAY) {
		props.variant = 'kline'
		props.interval = interval
		props.from = new Date(from).toISOString()
		props.to = new Date(to).toISOString()
		const periods = node.ema === false ? [] : Array.isArray(node.ema) ? node.ema : [5, 20]
		props.ema = periods.filter((period): period is number => Number.isInteger(period) && (period as number) >= 1 && (period as number) <= 200).slice(0, 2)
	}
	return props
}

// ———————————————————————————— 地图 ————————————————————————————

export interface MapPoi {
	lat: number
	lon: number
	title?: string
	description?: string
	address?: string
	phone?: string
	website?: string
}

function coordinate(value: unknown, limit: number) {
	return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined
}

/** 地点逐项校验：经纬度在范围内、文字纯文本限长、网站只收 http(s)、电话只留数字与 `+- `；最多 50 个 */
export function mapPoisOf(pois: unknown): MapPoi[] {
	return (Array.isArray(pois) ? pois : []).flatMap((raw): MapPoi[] => {
		if (typeof raw !== 'object' || raw === null)
			return []
		const poi = raw as Record<string, unknown>
		const lat = coordinate(poi.lat, 90)
		const lon = coordinate(poi.lon, 180)
		if (lat === undefined || lon === undefined)
			return []
		const merchant = typeof poi.merchant === 'object' && poi.merchant !== null ? poi.merchant as Record<string, unknown> : {}
		const out: MapPoi = { lat, lon }
		const title = plainOf(poi.title, 80)
		const description = plainOf(poi.description, 200)
		const address = plainOf(merchant.address, 120)
		const phone = str(merchant.phone).replace(/[^\d+\- ]/g, '').trim().slice(0, 30)
		const website = safeHref(merchant.website)
		if (title)
			out.title = title
		if (description)
			out.description = description
		if (address)
			out.address = address
		if (phone)
			out.phone = phone
		if (website && /^https?:\/\//i.test(website))
			out.website = website
		return [out]
	}).slice(0, 50)
}

/**
 * map 节点 → `map-block` 的属性：地点整理后序列化成 JSON 字符串（属性里不能放对象）；
 * 轨迹只记地址（https），取不取、从哪个主机取由服务端再判断。一个地点、一条轨迹都没有时返回 undefined
 */
export function mapPropsOf(node: Record<string, unknown>): Props | undefined {
	const pois = mapPoisOf(node.pois)
	const track = typeof node.track === 'object' && node.track !== null ? str((node.track as { url?: unknown }).url).trim() : ''
	const trackUrl = /^https:\/\/\S{1,2000}$/.test(track) ? track : undefined
	if (!pois.length && !trackUrl)
		return undefined
	const props: Props = { title: plainOf(node.title, 80), pois: JSON.stringify(pois) }
	if (trackUrl)
		props.trackUrl = trackUrl
	// 固定视角：`view.center` 是 [经度, 纬度]，缩放 0–22
	const view = typeof node.view === 'object' && node.view !== null ? node.view as Record<string, unknown> : {}
	const center = Array.isArray(view.center) ? [coordinate(view.center[0], 180), coordinate(view.center[1], 90)] : []
	const zoom = typeof view.zoom === 'number' && view.zoom >= 0 && view.zoom <= 22 ? view.zoom : undefined
	if (center[0] !== undefined && center[1] !== undefined && zoom !== undefined)
		props.view = JSON.stringify({ center, zoom })
	return props
}

/**
 * 轨迹文件（admin 上传的 JSON）→ 若干段 `[纬度, 经度]`：`points` 是 `[lat, lon, ele]`，另认 `segments`（每段一组点）。
 * 坐标不合法的点丢掉，总点数抽到 `max` 以内；另带距离、起止时间（有的话）
 */
export interface MapStop {
	lat: number
	lon: number
	/** 停留了多少秒 */
	duration: number
	visits?: number
	/** 开始时间（ISO） */
	time?: string
}

export function mapTrackOf(raw: unknown, max = 1000): { segments: { lat: number, lon: number }[][], stops: MapStop[], distance?: number, start?: number, end?: number } | undefined {
	if (typeof raw !== 'object' || raw === null)
		return undefined
	const data = raw as Record<string, unknown>
	const pointOf = (value: unknown) => {
		if (!Array.isArray(value))
			return undefined
		const lat = coordinate(value[0], 90)
		const lon = coordinate(value[1], 180)
		return lat === undefined || lon === undefined ? undefined : { lat, lon }
	}
	const rawSegments = Array.isArray(data.segments) && data.segments.length ? data.segments : [data.points]
	const segments = rawSegments
		.map(segment => (Array.isArray(segment) ? segment : []).map(pointOf).filter((point): point is { lat: number, lon: number } => Boolean(point)))
		.filter(segment => segment.length > 1)
		.slice(0, 50)
	const total = segments.reduce((sum, segment) => sum + segment.length, 0)
	if (!total)
		return undefined
	const sampled = total > max ? segments.map(segment => segmentSample(segment, Math.max(2, Math.floor(segment.length / total * max)))) : segments
	const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
	// 停留点：停留至少 10 分钟的才要，最多 100 个
	const stops = (Array.isArray(data.stops) ? data.stops : []).flatMap((item): MapStop[] => {
		const stop = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
		const lat = coordinate(stop.lat, 90)
		const lon = coordinate(stop.lon, 180)
		const duration = finite(stop.durationSec)
		if (lat === undefined || lon === undefined || duration === undefined || duration < 600)
			return []
		const visits = typeof stop.visits === 'number' && Number.isInteger(stop.visits) && stop.visits > 0 ? stop.visits : undefined
		const time = typeof stop.time === 'string' && Number.isFinite(Date.parse(stop.time)) ? new Date(stop.time).toISOString() : undefined
		return [{ lat, lon, duration: Math.round(duration), ...(visits ? { visits } : {}), ...(time ? { time } : {}) }]
	}).slice(0, 100)
	return { segments: sampled, stops, distance: finite(data.distanceMeters), start: finite(data.startTimeMs), end: finite(data.endTimeMs) }
}

function segmentSample<T>(items: T[], count: number): T[] {
	if (items.length <= count)
		return items
	const step = (items.length - 1) / (count - 1)
	return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]!)
}

/** 轨迹只从站点自己或 core 的主机取（admin 上传的文件在那里），别的主机一概不取 */
export function trustedTrackUrl(url: unknown, site: { webUrl?: string, serverUrl?: string } | undefined) {
	if (typeof url !== 'string')
		return undefined
	let parsed: URL
	try {
		parsed = new URL(url)
	}
	catch {
		return undefined
	}
	if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
		return undefined
	const hosts = [site?.webUrl, site?.serverUrl].flatMap((value) => {
		try {
			return value ? [new URL(value).host] : []
		}
		catch {
			return []
		}
	})
	return hosts.includes(parsed.host) ? parsed.href : undefined
}

// ———————————————————————————— markdown 里 core 投影的块 ————————————————————————————

const LITEXML_DATA_MAX = 20_000

/**
 * core 把 Lexical 投影成 markdown 时，股票、地图、相册写成 `<node type="…" id="…" data="{JSON}" />`（`litexml.ts`）。
 * 路径 B 认出来之后照 Lexical 的同一套校验转成同样的块；`data` 限 20 KB，认不出返回 undefined（调用方给占位）
 */
export function liteXmlBlockOf(props: Record<string, unknown>, ui: UiLang = 'zh'): MDCElement | undefined {
	const raw = props.data
	if (typeof raw !== 'string' || raw.length > LITEXML_DATA_MAX)
		return undefined
	let data: unknown
	try {
		data = JSON.parse(raw)
	}
	catch {
		return undefined
	}
	if (typeof data !== 'object' || data === null || Array.isArray(data))
		return undefined
	const node: Record<string, unknown> = { ...data as Record<string, unknown>, type: props.type }
	const element = (tag: string, elementProps: Props, children: MDCNode[] = []): MDCElement => ({ type: 'element', tag, props: elementProps, children })
	const text = (value: string): MDCNode => ({ type: 'text', value })
	switch (props.type) {
		case 'stock': {
			const stock = stockPropsOf(node)
			return stock && element('stock-block', stock)
		}
		case 'map': {
			const map = mapPropsOf(node)
			return map && element('map-block', map)
		}
		case 'afilmory': {
			const title = plainOf(node.title, 80) || translate(ui, 'content.album2')
			const caption = plainOf(node.caption, 200)
			const link = safeHref(node.baseUrl)
			return element('div', { className: ['mx-unsupported'] }, [
				element('p', {}, [element('em', {}, [text(translate(ui, 'content.albumsCantShown', { title }))])]),
				...caption ? [element('p', {}, [text(caption)])] : [],
				...link && /^https?:\/\//i.test(link) ? [element('p', {}, [element('a', { href: link, target: '_blank', rel: ['noopener', 'noreferrer'] }, [text(translate(ui, 'content.viewAlbum'))])])] : [],
			])
		}
		default:
			return undefined
	}
}

// ———————————————————————————— GitHub 文件与 Gist ————————————————————————————

export type GithubTarget
	= | { kind: 'file', url: string, owner: string, repo: string, ref: string, path: string, start?: number, end?: number }
		| { kind: 'gist', url: string, id: string }

const GITHUB_NAME = /^[\w.-]{1,100}$/

/** `github.com/<所有者>/<仓库>/blob/<分支或提交>/<路径>#L10-L20` 与 `gist.github.com/<用户>/<id>`；别的返回 undefined */
export function githubTargetOf(value: unknown): GithubTarget | undefined {
	if (typeof value !== 'string' || value.length > 500)
		return undefined
	let url: URL
	try {
		url = new URL(value)
	}
	catch {
		return undefined
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port)
		return undefined
	if (url.hostname === 'gist.github.com') {
		const id = /^\/[\w-]{1,40}\/([\da-f]{8,40})\/?$/i.exec(url.pathname)?.[1]
		return id ? { kind: 'gist', url: url.href, id } : undefined
	}
	if (url.hostname !== 'github.com')
		return undefined
	const [, owner, repo, blob, ref, ...rest] = url.pathname.split('/')
	if (blob !== 'blob' || !owner || !repo || !ref || !rest.length || ![owner, repo, ref, ...rest].every(part => GITHUB_NAME.test(part)) || rest.some(part => part === '.' || part === '..'))
		return undefined
	const lines = /^#L(\d{1,6})(?:-L(\d{1,6}))?$/.exec(url.hash)
	const start = lines ? Number(lines[1]) : undefined
	const end = lines?.[2] ? Math.max(Number(lines[2]), start!) : start
	return { kind: 'file', url: url.href, owner, repo, ref, path: rest.join('/'), ...(start ? { start, end } : {}) }
}

const LANGUAGES: Record<string, string> = {
	ts: 'ts',
	tsx: 'tsx',
	js: 'js',
	mjs: 'js',
	cjs: 'js',
	jsx: 'jsx',
	vue: 'vue',
	py: 'python',
	go: 'go',
	rs: 'rust',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	json: 'json',
	yml: 'yaml',
	yaml: 'yaml',
	md: 'md',
	css: 'css',
	scss: 'scss',
	html: 'html',
	java: 'java',
	kt: 'kotlin',
	swift: 'swift',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	hpp: 'cpp',
	cs: 'csharp',
	rb: 'ruby',
	php: 'php',
	sql: 'sql',
	toml: 'toml',
	xml: 'xml',
	lua: 'lua',
	dart: 'dart',
	nix: 'nix',
}

/** 文件名 → 代码块的语言（认不出是 text） */
export function languageOfPath(path: string) {
	const name = path.split('/').pop()!.toLowerCase()
	if (name === 'dockerfile')
		return 'docker'
	return LANGUAGES[name.split('.').pop() ?? ''] ?? 'text'
}

/** 最多显示这么多行 */
export const GITHUB_MAX_LINES = 200

/** 按行截取：有行号范围就取那几行，没有就取开头；返回代码与实际的起止行 */
export function sliceLines(text: string, start?: number, end?: number) {
	const lines = text.replace(/\r\n?/g, '\n').split('\n')
	if (lines.at(-1) === '')
		lines.pop()
	const from = Math.min(Math.max(1, start ?? 1), Math.max(1, lines.length))
	const to = Math.min(lines.length, end ?? lines.length, from + GITHUB_MAX_LINES - 1)
	return { code: lines.slice(from - 1, to).join('\n'), from, to, total: lines.length }
}
