import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import type { SiteConfig } from '~~/app/types/site'
import type { GithubTarget } from '~~/app/utils/mx/rich-blocks'
import type { UiLang } from '~~/shared/utils/i18n'
import { Buffer } from 'node:buffer'
import { candleChart, mapChart, trackDistance } from '~~/app/utils/mx/charts'
import { soleUrlLink } from '~~/app/utils/mx/enrichment'
import { githubTargetOf, languageOfPath, mapPoisOf, mapTrackOf, sliceLines, trustedTrackUrl } from '~~/app/utils/mx/rich-blocks'
import { loadStockBars, loadStockQuote } from '~~/app/utils/mx/stocks'
import { translate } from '~~/shared/utils/i18n'

/**
 * 详情页的股票块、地图块：渲染完正文后在服务端取数据、算好图，写进 AST，浏览器不和任何第三方通信。
 *
 * - 行情走 core 的内置云函数，全站共享缓存（快照 60 秒；K 线的区间已经过去就缓存 1 天，否则 10 分钟），
 *   不转访客 IP；失败也缓存 60 秒（null），免得每次打开都卡在超时上；单次最多等 2 秒；
 * - 轨迹文件只从站点或 core 的主机取（https），不跟随重定向，超过 2 MB 或 3 秒就放弃，按地址缓存 1 天；
 * - 每篇最多 10 个股票块、5 个地图块，多的照旧显示「暂不可用」
 */
const TIMEOUT = 2000
const MAX_STOCKS = 10
const MAX_MAPS = 5
const TRACK_MAX_BYTES = 2 * 1024 * 1024

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
	return Promise.race([promise, new Promise<null>(resolve => setTimeout(resolve, ms, null))])
}

const getCachedQuote = defineCachedFunction(
	(symbol: string) => loadStockQuote(useServerMxClient(), symbol).then(quote => quote ?? null, () => null),
	{ name: 'mx-stock-quote', maxAge: 60, getKey: (symbol: string) => symbol },
)

const loadBars = (symbol: string, interval: string, from: string, to: string) => loadStockBars(useServerMxClient(), symbol, interval, from, to).then(bars => bars ?? null, () => null)
const barsKey = (symbol: string, interval: string, from: string, to: string) => `${symbol}|${interval}|${from}|${to}`
/** 区间还没结束的 K 线：10 分钟 */
const getCachedLiveBars = defineCachedFunction(loadBars, { name: 'mx-stock-bars', maxAge: 600, getKey: barsKey })
/** 区间已经过去的历史数据不会再变：1 天 */
const getCachedPastBars = defineCachedFunction(loadBars, { name: 'mx-stock-bars-past', maxAge: 86_400, getKey: barsKey })

async function fetchTrack(url: string) {
	const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000), headers: { accept: 'application/json' } })
	if (!res.ok || !res.body)
		return null
	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done)
			break
		size += value.byteLength
		if (size > TRACK_MAX_BYTES) {
			await reader.cancel()
			return null
		}
		chunks.push(value)
	}
	const text = new TextDecoder().decode(Buffer.concat(chunks))
	return mapTrackOf(JSON.parse(text)) ?? null
}

const getCachedTrack = defineCachedFunction(
	(url: string) => fetchTrack(url).catch(() => null),
	{ name: 'mx-map-track', maxAge: 86_400, getKey: (url: string) => url },
)

// —— GitHub 文件与 Gist ——
const GITHUB_MAX_BYTES = 256 * 1024
const MAX_GITHUB = 5
/** 取不到的 10 分钟内不再去取（GitHub 对匿名调用有限流） */
const githubFailedUntil = new Map<string, number>()

async function readLimited(res: Response) {
	if (!res.ok || !res.body)
		return undefined
	const reader = res.body.getReader()
	const chunks: Uint8Array[] = []
	let size = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done)
			break
		size += value.byteLength
		if (size > GITHUB_MAX_BYTES) {
			await reader.cancel()
			return undefined
		}
		chunks.push(value)
	}
	return new TextDecoder().decode(Buffer.concat(chunks))
}

async function fetchGithub(target: GithubTarget): Promise<{ text: string, name: string } | undefined> {
	const init = { redirect: 'error' as const, signal: AbortSignal.timeout(3000), headers: { 'user-agent': 'mx-clarity' } }
	if (target.kind === 'file') {
		const res = await fetch(`https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.ref}/${target.path}`, init)
		const text = await readLimited(res)
		return text === undefined ? undefined : { text, name: target.path }
	}
	const res = await fetch(`https://api.github.com/gists/${target.id}`, { ...init, headers: { ...init.headers, accept: 'application/vnd.github+json' } })
	const raw = await readLimited(res)
	const files = raw ? (JSON.parse(raw) as { files?: Record<string, { filename?: unknown, content?: unknown }> }).files : undefined
	const first = files ? Object.values(files)[0] : undefined
	return typeof first?.content === 'string' && typeof first.filename === 'string' ? { text: first.content, name: first.filename.slice(0, 100) } : undefined
}

const getCachedGithub = defineCachedFunction(
	async (url: string) => {
		const target = githubTargetOf(url)
		if (!target || (githubFailedUntil.get(url) ?? 0) > Date.now())
			return undefined
		const result = await fetchGithub(target).catch(() => undefined)
		if (result)
			return result
		if (githubFailedUntil.size > 1000)
			githubFailedUntil.clear()
		githubFailedUntil.set(url, Date.now() + 10 * 60_000)
		return undefined
	},
	{ name: 'mx-github-embed', maxAge: 86_400, getKey: (url: string) => url },
)

/** 取到文件就把这个节点就地换成「带文件名与行号的代码块 + 在 GitHub 上看」；取不到原样不动（照旧是链接或卡片） */
async function hydrateGithub(element: MDCElement, target: GithubTarget, ui: UiLang) {
	const file = await within(getCachedGithub(target.url), 3500)
	if (!file)
		return
	const { code, from, to, total } = sliceLines(file.text, target.kind === 'file' ? target.start : undefined, target.kind === 'file' ? target.end : undefined)
	const label = target.kind === 'file' ? `${target.owner}/${target.repo} · ${target.path}` : `Gist · ${file.name}`
	const range = total > 1 ? `#L${from}-L${to}` : ''
	const value = `${code}\n`
	const language = languageOfPath(file.name)
	element.tag = 'div'
	element.props = { className: ['github-embed'] }
	element.children = [
		{ type: 'element', tag: 'pre', props: { className: [`language-${language}`], code: value, language, filename: `${label}${range}`, meta: '' }, children: [{ type: 'element', tag: 'code', props: { __ignoreMap: '' }, children: [{ type: 'text', value }] }] },
		{ type: 'element', tag: 'p', props: { className: ['github-embed-link'] }, children: [
			{ type: 'element', tag: 'a', props: { href: target.url, target: '_blank', rel: ['noopener', 'noreferrer'] }, children: [{ type: 'text', value: to < total && !(target.kind === 'file' && target.start) ? translate(ui, 'content.viewGithubShowing', { n: to }) : translate(ui, 'content.viewGithub') }] },
		] },
	]
}

function distanceText(meters: number, ui: UiLang) {
	return meters >= 1000
		? translate(ui, 'content.km', { n: (meters / 1000).toFixed(meters >= 10_000 ? 0 : 1) })
		: translate(ui, 'content.m', { n: Math.round(meters) })
}

function durationText(ms: number, ui: UiLang) {
	const minutes = Math.round(ms / 60_000)
	const hours = Math.floor(minutes / 60)
	if (!hours)
		return translate(ui, 'content.min', { m: minutes })
	return minutes % 60 ? translate(ui, 'content.hrMin', { h: hours, m: minutes % 60 }) : translate(ui, 'content.hr', { h: hours })
}

async function hydrateStock(element: MDCElement) {
	const props = element.props ?? {}
	const symbol = String(props.symbol ?? '')
	if (props.variant === 'kline') {
		const periods = Array.isArray(props.ema) ? props.ema.filter((period): period is number => typeof period === 'number') : []
		const [interval, from, to] = [String(props.interval), String(props.from), String(props.to)]
		const past = Date.parse(to) < Date.now() - 60_000
		const data = await within((past ? getCachedPastBars : getCachedLiveBars)(symbol, interval, from, to), TIMEOUT)
		const chart = data && candleChart(data.bars, periods)
		if (!data || !chart) {
			element.props = { ...props, unavailable: true }
			return
		}
		// 每一根的「时间、开、高、低、收、量」给浏览器画十字线与悬停数值（JSON 字符串：MDCRenderer 不收对象属性）
		const bars = JSON.stringify(data.bars.map(bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume]))
		element.props = { ...props, name: data.name, currency: data.currency, chartWidth: chart.width, chartHeight: chart.height, up: chart.up, down: chart.down, wicks: chart.wicks, emas: JSON.stringify(chart.emas), low: chart.min, high: chart.max, bars }
		return
	}
	const quote = await within(getCachedQuote(symbol), TIMEOUT)
	element.props = quote
		? { ...props, name: quote.name, exchange: quote.exchange, currency: quote.currency, price: quote.price, previousClose: quote.previousClose, dayHigh: quote.dayHigh, dayLow: quote.dayLow, high52: quote.high52, low52: quote.low52, volume: quote.volume, asOf: quote.asOf, open: quote.open, spark: quote.spark }
		: { ...props, unavailable: true }
}

async function hydrateMap(element: MDCElement, site: SiteConfig | undefined, ui: UiLang) {
	const props = element.props ?? {}
	let pois: ReturnType<typeof mapPoisOf> = []
	try {
		pois = mapPoisOf(JSON.parse(String(props.pois ?? '[]')))
	}
	catch {}
	const trackUrl = trustedTrackUrl(props.trackUrl, site)
	const track = trackUrl ? await within(getCachedTrack(trackUrl), 3500) : null
	const chart = mapChart(track?.segments ?? [], pois)
	const next: Record<string, unknown> = { title: props.title, pois: JSON.stringify(pois), ...(props.view ? { view: props.view } : {}) }
	if (chart) {
		Object.assign(next, { chartWidth: chart.width, chartHeight: chart.height, tracks: JSON.stringify(chart.tracks), markerX: chart.markers.map(point => point.x), markerY: chart.markers.map(point => point.y) })
	}
	if (track) {
		// 交互地图用的坐标（[经度, 纬度]，6 位小数）与停留点：浏览器不连轨迹文件的主机
		next.route = JSON.stringify(track.segments.map(segment => segment.map(point => [Math.round(point.lon * 1e6) / 1e6, Math.round(point.lat * 1e6) / 1e6])))
		if (track.stops.length)
			next.stops = JSON.stringify(track.stops)
		const distance = track.distance ?? track.segments.reduce((sum, segment) => sum + trackDistance(segment), 0)
		if (distance > 0)
			next.distance = distanceText(distance, ui)
		if (track.start && track.end && track.end > track.start)
			next.duration = durationText(track.end - track.start, ui)
	}
	else if (props.trackUrl) {
		next.trackMissing = true
	}
	element.props = next
}

/** 就地给正文里的股票块、地图块补上数据；任何一步失败都只是那一块显示「暂不可用」 */
export async function hydrateRichBlocks(body: MDCRoot, ui: UiLang = 'zh') {
	const stocks: MDCElement[] = []
	const maps: MDCElement[] = []
	const github: { element: MDCElement, target: GithubTarget }[] = []
	const walk = (nodes: MDCNode[] = []) => {
		for (const node of nodes) {
			if (node.type !== 'element')
				continue
			if (node.tag === 'stock-block') {
				stocks.push(node)
				continue
			}
			if (node.tag === 'map-block') {
				maps.push(node)
				continue
			}
			// 链接卡片、单独成段的网址指向 GitHub 文件或 Gist
			const link = node.tag === 'link-card' ? node.props?.link : node.tag === 'p' ? soleUrlLink(node)?.props?.href : undefined
			const target = githubTargetOf(link)
			if (target) {
				github.push({ element: node, target })
				continue
			}
			walk(node.children)
		}
	}
	walk(body.children)
	if (!stocks.length && !maps.length && !github.length)
		return body
	const site = maps.length ? await getCachedSiteConfig().catch(() => undefined) : undefined
	stocks.slice(MAX_STOCKS).forEach(element => element.props = { ...element.props, unavailable: true })
	maps.slice(MAX_MAPS).forEach(element => element.props = { title: element.props?.title, pois: element.props?.pois })
	await Promise.all([
		...stocks.slice(0, MAX_STOCKS).map(hydrateStock),
		...maps.slice(0, MAX_MAPS).map(element => hydrateMap(element, site, ui)),
		...github.slice(0, MAX_GITHUB).map(({ element, target }) => hydrateGithub(element, target, ui)),
	])
	return body
}
