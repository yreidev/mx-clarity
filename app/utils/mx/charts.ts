/**
 * 行情与地图的静态图：在服务端算好 SVG 的路径字符串，交给组件原样画，浏览器不取任何第三方数据。纯模块。
 * 输入都已校验成有限数；输出只有数字拼成的路径，没有文字，不会带出别的东西。
 */

import type { ChartFormat, ChartRow, ChartSpec } from './rich-blocks'

const round = (value: number) => Math.round(value * 10) / 10

/** 均匀抽稀到最多 `max` 个点（保留首尾） */
export function downsample<T>(items: T[], max: number): T[] {
	if (items.length <= max)
		return items
	const step = (items.length - 1) / (max - 1)
	return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]!)
}

/** 走势小图：收盘价 → `M x y L …`，画在 `width × height` 的框里，上下留 2 像素 */
export function sparklinePath(values: number[], width = 120, height = 36) {
	const points = values.filter(Number.isFinite)
	if (points.length < 2)
		return ''
	const min = Math.min(...points)
	const max = Math.max(...points)
	const span = max - min || 1
	return points.map((value, i) => {
		const x = round(i / (points.length - 1) * width)
		const y = round(height - 2 - (value - min) / span * (height - 4))
		return `${i ? 'L' : 'M'}${x} ${y}`
	}).join(' ')
}

export interface Bar {
	open: number
	high: number
	low: number
	close: number
}

/** 指数移动平均；前 `period - 1` 根没有值 */
export function ema(values: number[], period: number): (number | undefined)[] {
	const k = 2 / (period + 1)
	let previous: number | undefined
	return values.map((value, i) => {
		if (i < period - 1)
			return undefined
		previous = previous === undefined ? values.slice(0, period).reduce((a, b) => a + b, 0) / period : value * k + previous * (1 - k)
		return previous
	})
}

export interface CandleChart {
	width: number
	height: number
	/** 收涨与收跌的实体、所有影线，各一条路径 */
	up: string
	down: string
	wicks: string
	/** 每条 EMA 一条路径 */
	emas: string[]
	min: number
	max: number
}

/** K 线图：每根占等宽的一格，实体宽度是格子的六成；EMA 按收盘价算 */
export function candleChart(bars: Bar[], periods: number[] = [], width = 600, height = 220): CandleChart | undefined {
	const valid = bars.filter(bar => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
	if (valid.length < 2)
		return undefined
	const min = Math.min(...valid.map(bar => bar.low))
	const max = Math.max(...valid.map(bar => bar.high))
	const span = max - min || 1
	const y = (value: number) => round(height - 4 - (value - min) / span * (height - 8))
	const slot = width / valid.length
	const body = Math.max(1, slot * 0.6)
	let up = ''
	let down = ''
	let wicks = ''
	valid.forEach((bar, i) => {
		const center = slot * i + slot / 2
		const top = y(Math.max(bar.open, bar.close))
		const bottom = y(Math.min(bar.open, bar.close))
		const rect = `M${round(center - body / 2)} ${top} h${round(body)} V${Math.max(bottom, top + 1)} h${round(-body)} Z `
		if (bar.close >= bar.open)
			up += rect
		else
			down += rect
		wicks += `M${round(center)} ${y(bar.high)} V${y(bar.low)} `
	})
	const closes = valid.map(bar => bar.close)
	const emas = periods.map(period => ema(closes, period)
		.map((value, i) => value === undefined ? '' : `${i === period - 1 ? 'M' : 'L'}${round(slot * i + slot / 2)} ${y(value)}`)
		.filter(Boolean)
		.join(' '))
		.filter(Boolean)
	return { width, height, up: up.trim(), down: down.trim(), wicks: wicks.trim(), emas, min, max }
}

// ———————————————————————————— 地图 ————————————————————————————

export interface GeoPoint {
	lat: number
	lon: number
}

/** Web Mercator：经纬度 → 平面坐标（单位无所谓，后面按包围盒缩放） */
function mercator({ lat, lon }: GeoPoint) {
	const phi = Math.max(-85, Math.min(85, lat)) * Math.PI / 180
	return { x: lon, y: -Math.log(Math.tan(Math.PI / 4 + phi / 2)) * 180 / Math.PI }
}

export interface MapChart {
	width: number
	height: number
	/** 轨迹：每段一条路径 */
	tracks: string[]
	/** 地点在图上的位置，顺序与输入相同 */
	markers: { x: number, y: number }[]
}

/**
 * 示意图：把轨迹与地点按同一个包围盒投影到 `width × height` 里（等比，留边），不画底图。
 * 只有一个点时放在正中
 */
export function mapChart(tracks: GeoPoint[][], pois: GeoPoint[], width = 600, height = 360, padding = 24): MapChart | undefined {
	const all = [...tracks.flat(), ...pois].map(mercator)
	if (!all.length)
		return undefined
	const minX = Math.min(...all.map(p => p.x))
	const maxX = Math.max(...all.map(p => p.x))
	const minY = Math.min(...all.map(p => p.y))
	const maxY = Math.max(...all.map(p => p.y))
	const spanX = maxX - minX
	const spanY = maxY - minY
	const scale = spanX || spanY ? Math.min((width - padding * 2) / (spanX || spanY), (height - padding * 2) / (spanY || spanX)) : 1
	const offsetX = (width - spanX * scale) / 2
	const offsetY = (height - spanY * scale) / 2
	const project = (point: GeoPoint) => {
		const p = mercator(point)
		return { x: round((p.x - minX) * scale + offsetX), y: round((p.y - minY) * scale + offsetY) }
	}
	return {
		width,
		height,
		tracks: tracks.filter(track => track.length > 1).map(track => track.map(project).map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')),
		markers: pois.map(project),
	}
}

/** 轨迹长度（米，大圆距离） */
export function trackDistance(track: GeoPoint[]) {
	let total = 0
	for (let i = 1; i < track.length; i++) {
		const a = track[i - 1]!
		const b = track[i]!
		const toRad = Math.PI / 180
		const dLat = (b.lat - a.lat) * toRad
		const dLon = (b.lon - a.lon) * toRad
		const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2
		total += 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
	}
	return total
}

// ———————————————————————————— 通用文章图表（@haklex/rich-ext-chart） ————————————————————————————

const COMPACT_STEPS: ReadonlyArray<readonly [number, string]> = [
	[1e9, 'B'],
	[1e6, 'M'],
	[1e3, 'k'],
]
const PREFIX_UNITS = new Set(['$', '¥', '€', '£'])
const ATTACHED_UNITS = new Set(['%', '×', 'x'])

const CHART_PALETTE = [
	'var(--mx-chart-1)',
	'var(--mx-chart-2)',
	'var(--mx-chart-3)',
	'var(--mx-chart-4)',
	'var(--mx-chart-5)',
	'var(--mx-chart-6)',
] as const

export function formatChartValue(value: number | null | undefined, format: ChartFormat = {}): string {
	if (value == null || Number.isNaN(value))
		return '—'
	const abs = Math.abs(value)
	let body: string
	const step = format.compact !== false ? COMPACT_STEPS.find(([d]) => abs >= d) : undefined
	if (step) {
		const q = abs / step[0]
		body = (q < 10 ? q.toFixed(1) : String(Math.round(q))).replace(/\.0$/, '') + step[1]
	}
	else if (format.decimals != null) {
		body = abs.toFixed(format.decimals)
	}
	else {
		body = String(+abs.toFixed(2))
	}
	const sign = value < 0 ? '−' : format.signed && value > 0 ? '+' : ''
	const { unit } = format
	if (!unit)
		return sign + body
	if (PREFIX_UNITS.has(unit))
		return sign + unit + body
	if (ATTACHED_UNITS.has(unit))
		return sign + body + unit
	return `${sign}${body} ${unit}`
}

export function formatChartTick(value: number, format: ChartFormat = {}, withUnit = false) {
	return formatChartValue(value, {
		...format,
		signed: false,
		unit: withUnit ? format.unit : undefined,
	})
}

function estimateTextWidth(text: string, fontSize: number) {
	let width = 0
	for (const ch of text)
		width += ch.charCodeAt(0) > 0x2E80 ? fontSize : fontSize * 0.58
	return width
}

export function chartRowNumber(row: ChartRow, key: string): number | null {
	const v = row[key]
	return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function chartRowLabel(row: ChartRow, xKey: string): string {
	const v = row[xKey]
	return v == null ? '' : String(v)
}

export function chartSeriesName(spec: ChartSpec, index: number): string {
	const s = spec.series[index]
	return s ? (s.label || s.key) : ''
}

export function chartColorOf(spec: ChartSpec, index: number): string {
	const s = spec.series[index]
	if (!s)
		return CHART_PALETTE[0]
	if (spec.highlight && spec.type !== 'pie' && s.key !== spec.highlight)
		return 'var(--mx-chart-muted)'
	const idx = s.color != null ? s.color - 1 : index
	return CHART_PALETTE[((idx % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length]!
}

interface NiceAxis {
	domain: [number, number]
	ticks: number[]
	labels: string[]
	width: number
}

function niceScale(minInput: number, maxInput: number, maxTicks = 5): { domain: [number, number], ticks: number[] } {
	let lo = minInput
	let hi = maxInput
	if (hi === lo)
		hi = lo + 1
	if (hi < lo)
		[lo, hi] = [hi, lo]
	const span = hi - lo
	const rawStep = span / Math.max(2, maxTicks - 1)
	const mag = 10 ** Math.floor(Math.log10(rawStep))
	const norm = rawStep / mag
	const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
	const step = nice * mag
	const niceMin = Math.floor(lo / step) * step
	const niceMax = Math.ceil(hi / step) * step
	const ticks: number[] = []
	for (let v = niceMin; v <= niceMax + step * 1e-6; v += step)
		ticks.push(Number(v.toPrecision(12)))
	return { domain: [niceMin, niceMax], ticks }
}

function buildYAxis(min: number, max: number, format: ChartFormat | undefined, bounds: ChartSpec['y']): NiceAxis {
	const lo = Math.min(0, bounds?.min ?? min)
	const hi = Math.max(0, bounds?.max ?? max)
	const { domain, ticks } = niceScale(lo, hi, 5)
	const labels = ticks.map((t, i) => formatChartTick(t, format, i === ticks.length - 1))
	const width = Math.max(36, Math.max(...labels.map(l => estimateTextWidth(l, 11))) + 12)
	return { domain, ticks, labels, width }
}

function linearMap(value: number, domain: [number, number], range: [number, number]) {
	const span = domain[1] - domain[0] || 1
	return range[0] + (value - domain[0]) / span * (range[1] - range[0])
}

function filterXLabels(labels: string[], centers: number[], y: number, rotate: boolean) {
	if (rotate)
		return labels.map((label, i) => ({ x: round(centers[i]!), y: round(y), label, rotate: true }))
	const out: Array<{ x: number, y: number, label: string, rotate: boolean }> = []
	let lastRight = -Infinity
	for (let i = 0; i < labels.length; i++) {
		const label = labels[i]!
		const cx = centers[i]!
		const half = estimateTextWidth(label, 12) / 2
		if (cx - half < lastRight + 14)
			continue
		lastRight = cx + half
		out.push({ x: round(cx), y: round(y), label, rotate: false })
	}
	return out
}

function buildRefs(spec: ChartSpec, yOf: (v: number) => number, left: number, right: number) {
	return (spec.refs ?? []).map(ref => ({
		y: round(yOf(ref.y)),
		x1: round(left),
		x2: round(right),
		label: ref.label,
	}))
}

function barRectPath(x: number, w: number, base: number, end: number, radius: number) {
	const rx = round(x)
	const rw = round(w)
	const rb = round(base)
	const re = round(end)
	const h = Math.abs(re - rb)
	const r = round(Math.min(radius, rw / 2, h))
	if (re <= rb)
		return `M${rx},${rb}V${round(re + r)}Q${rx},${re} ${round(rx + r)},${re}H${round(rx + rw - r)}Q${round(rx + rw)},${re} ${round(rx + rw)},${round(re + r)}V${rb}Z`
	return `M${rx},${rb}V${round(re - r)}Q${rx},${re} ${round(rx + r)},${re}H${round(rx + rw - r)}Q${round(rx + rw)},${re} ${round(rx + rw)},${round(re - r)}V${rb}Z`
}

export interface BarRect {
	path: string
	color: string
	seriesIndex: number
	rowIndex: number
	xCenter: number
	valueLabel?: string
	valueY?: number
}

export interface BarChartLayout {
	width: number
	height: number
	ml: number
	mb: number
	plotBottom: number
	band: number
	centers: number[]
	yTicks: Array<{ y: number, label: string, zero: boolean }>
	xLabels: Array<{ x: number, y: number, label: string, rotate: boolean }>
	refs: Array<{ y: number, x1: number, x2: number, label: string }>
	bars: BarRect[]
}

export function buildBarChart(spec: ChartSpec, width = 720, height = 300): BarChartLayout {
	const n = Math.max(1, spec.data.length)
	const k = spec.series.length
	const stacked = !!spec.stacked

	interface StackSegment { series: number, value: number, y0: number, y1: number, rounded: boolean }
	const segments: StackSegment[][] | undefined = stacked
		? spec.data.map((row) => {
				let pos = 0
				let neg = 0
				const segs: StackSegment[] = spec.series.map((s, j) => {
					const v = chartRowNumber(row, s.key) ?? 0
					if (v >= 0) {
						const y0 = pos
						pos += v
						return { series: j, value: v, y0, y1: pos, rounded: false }
					}
					const y0 = neg
					neg += v
					return { series: j, value: v, y0, y1: neg, rounded: false }
				})
				const top = segs.filter(g => g.value > 0).sort((a, b) => b.y1 - a.y1)[0]
				const bottom = segs.filter(g => g.value < 0).sort((a, b) => a.y0 - b.y0)[0]
				if (top)
					top.rounded = true
				if (bottom)
					bottom.rounded = true
				return segs
			})
		: undefined

	let min = 0
	let max = 0
	for (const [i, row] of spec.data.entries()) {
		if (segments) {
			for (const g of segments[i]!) {
				min = Math.min(min, g.y0, g.y1)
				max = Math.max(max, g.y0, g.y1)
			}
		}
		else {
			for (const s of spec.series) {
				const v = chartRowNumber(row, s.key) ?? 0
				min = Math.min(min, v)
				max = Math.max(max, v)
			}
		}
	}
	for (const r of spec.refs ?? [])
		max = Math.max(max, r.y)

	const axis = buildYAxis(min, max, spec.format, spec.y)
	const labels = spec.data.map(row => chartRowLabel(row, spec.x))
	const ml = round(axis.width)
	const plotW = width - ml - 8
	const maxLabel = labels.length ? Math.max(...labels.map(l => estimateTextWidth(l, 12))) : 0
	const rotate = labels.length > 0 && maxLabel > plotW / n - 8
	const mb = rotate ? Math.min(maxLabel, 120) * 0.62 + 20 : 28
	const plotBottom = height - mb
	const yOf = (v: number) => linearMap(v, axis.domain, [plotBottom, 12])
	const band = plotW / n
	const centers = labels.map((_, i) => round(ml + (i + 0.5) * band))
	const zeroY = yOf(0)
	const showValues = !segments && k <= 2
	const bars: BarRect[] = []

	for (let i = 0; i < spec.data.length; i++) {
		const row = spec.data[i]!
		const cx = centers[i]!
		if (segments) {
			const bw = Math.min(28, band * 0.56)
			for (const g of segments[i]!) {
				if (g.value === 0)
					continue
				const base = g.value > 0 ? yOf(g.y0) : yOf(g.y1)
				const end = g.value > 0 ? yOf(g.y1) : yOf(g.y0)
				bars.push({
					path: barRectPath(cx - bw / 2, bw, base, end, g.rounded ? 4 : 0),
					color: chartColorOf(spec, g.series),
					seriesIndex: g.series,
					rowIndex: i,
					xCenter: cx,
				})
			}
			continue
		}
		const gap = 2
		const bw = Math.max(4, Math.min(24, (band * 0.72 - (k - 1) * gap) / k))
		const gw = k * bw + (k - 1) * gap
		for (let j = 0; j < k; j++) {
			const v = chartRowNumber(row, spec.series[j]!.key)
			if (v == null)
				continue
			const bx = cx - gw / 2 + j * (bw + gap)
			const yEnd = yOf(v)
			const item: BarRect = {
				path: barRectPath(bx, bw, zeroY, yEnd, 4),
				color: chartColorOf(spec, j),
				seriesIndex: j,
				rowIndex: i,
				xCenter: round(bx + bw / 2),
			}
			if (showValues) {
				item.valueLabel = formatChartValue(v, spec.format)
				item.valueY = round(v >= 0 ? yEnd - 6 : yEnd + 14)
			}
			bars.push(item)
		}
	}

	return {
		width,
		height,
		ml,
		mb,
		plotBottom: round(plotBottom),
		band: round(band),
		centers,
		yTicks: axis.ticks.map((t, i) => ({ y: round(yOf(t)), label: axis.labels[i]!, zero: t === 0 })),
		xLabels: filterXLabels(labels, centers, height - mb + 18, rotate),
		refs: buildRefs(spec, yOf, ml, width - 8),
		bars,
	}
}

export interface LineSeriesPath {
	seriesIndex: number
	color: string
	name: string
	highlighted: boolean
	dimmed: boolean
	linePaths: string[]
	areaPaths: string[]
	points: Array<{ rowIndex: number, cx: number, cy: number, value: number | null }>
	endLabel?: { x: number, y: number, name: string, value: string }
}

export interface LineChartLayout {
	width: number
	height: number
	ml: number
	mb: number
	plotBottom: number
	plotW: number
	isArea: boolean
	yTicks: Array<{ y: number, label: string, zero: boolean }>
	xLabels: Array<{ x: number, y: number, label: string, rotate: boolean }>
	xCenters: number[]
	refs: Array<{ y: number, x1: number, x2: number, label: string }>
	series: LineSeriesPath[]
}

export function buildLineChart(spec: ChartSpec, width = 720, height = 300): LineChartLayout {
	const n = spec.data.length
	const isArea = spec.type === 'area'
	const stacked = isArea && !!spec.stacked
	const acc = spec.data.map(() => 0)
	const layers = spec.series.map(s => spec.data.map((row, i) => {
		const value = chartRowNumber(row, s.key)
		const v = value ?? 0
		const lo = stacked ? acc[i]! : 0
		const hi = stacked ? (acc[i] = acc[i]! + v) : v
		return { i, value, lo, hi }
	}))

	let min = 0
	let max = 0
	for (const layer of layers) {
		for (const pt of layer) {
			if (pt.value == null)
				continue
			min = Math.min(min, pt.lo, pt.hi)
			max = Math.max(max, pt.hi)
		}
	}
	for (const r of spec.refs ?? [])
		max = Math.max(max, r.y)

	const axis = buildYAxis(min, max, spec.format, spec.y)
	const direct = spec.series.length <= 3 && n > 0
	const last = Math.max(0, n - 1)
	const mr = direct
		? Math.max(...spec.series.map((_, j) => estimateTextWidth(chartSeriesName(spec, j), 12) + estimateTextWidth(formatChartValue(layers[j]?.[last]?.value, spec.format), 12))) + 24
		: 8
	const ml = round(axis.width)
	const mb = 28
	const plotBottom = height - mb
	const plotW = Math.max(40, width - ml - mr)
	const xAt = (i: number) => round(ml + (n <= 1 ? plotW / 2 : i * plotW / (n - 1)))
	const yOf = (v: number) => linearMap(v, axis.domain, [plotBottom, 12])
	const xCenters = spec.data.map((_, i) => xAt(i))

	const order = [...spec.series.keys()].sort((a, b) => Number(spec.series[a]!.key === spec.highlight) - Number(spec.series[b]!.key === spec.highlight))

	// 末尾直标按 Y 顺序铺开，至少间隔 16px 防止标签叠字
	const endTargets = direct
		? order
				.filter(j => layers[j]![last]?.value != null)
				.map(j => ({ j, y: yOf(layers[j]![last]!.hi) }))
				.sort((a, b) => a.y - b.y)
		: []
	for (let i = 1; i < endTargets.length; i++) {
		if (endTargets[i]!.y - endTargets[i - 1]!.y < 16)
			endTargets[i]!.y = endTargets[i - 1]!.y + 16
	}
	const endBySeries = new Map(endTargets.map(e => [e.j, round(e.y)]))

	const series = order.map((j): LineSeriesPath => {
		const pts = layers[j]!
		const linePaths: string[] = []
		const areaPaths: string[] = []
		let seg: typeof pts = []
		const flushSeg = () => {
			if (!seg.length)
				return
			if (seg.length === 1) {
				const p = seg[0]!
				linePaths.push(`M${xAt(p.i)},${round(yOf(p.hi))}`)
				seg = []
				return
			}
			linePaths.push(seg.map((p, idx) => `${idx ? 'L' : 'M'}${xAt(p.i)},${round(yOf(p.hi))}`).join(' '))
			if (isArea) {
				const top = seg.map((p, idx) => `${idx ? 'L' : 'M'}${xAt(p.i)},${round(yOf(p.hi))}`)
				const bot = [...seg].reverse().map(p => `L${xAt(p.i)},${round(yOf(p.lo))}`)
				areaPaths.push(`${top.join(' ')} ${bot.join(' ')} Z`)
			}
			seg = []
		}
		for (const p of pts) {
			if (p.value == null)
				flushSeg()
			else
				seg.push(p)
		}
		flushSeg()

		const sKey = spec.series[j]!.key
		const endY = endBySeries.get(j)
		return {
			seriesIndex: j,
			color: chartColorOf(spec, j),
			name: chartSeriesName(spec, j),
			highlighted: spec.highlight === sKey,
			dimmed: Boolean(spec.highlight && spec.highlight !== sKey),
			linePaths,
			areaPaths,
			points: pts.map(p => ({ rowIndex: p.i, cx: xAt(p.i), cy: round(yOf(p.hi)), value: p.value })),
			endLabel: endY !== undefined
				? { x: round(ml + plotW + 10), y: endY, name: chartSeriesName(spec, j), value: formatChartValue(pts[last]!.value, spec.format) }
				: undefined,
		}
	})

	return {
		width,
		height,
		ml,
		mb,
		plotBottom: round(plotBottom),
		plotW: round(plotW),
		isArea,
		yTicks: axis.ticks.map((t, i) => ({ y: round(yOf(t)), label: axis.labels[i]!, zero: t === 0 })),
		xLabels: filterXLabels(spec.data.map(row => chartRowLabel(row, spec.x)), xCenters, height - mb + 18, false),
		xCenters,
		refs: buildRefs(spec, yOf, ml, ml + plotW),
		series,
	}
}

export interface PieSlice {
	index: number
	path: string
	color: string
	label: string
	value: number
	formatted: string
	pct: string
	legendY: number
}

export interface PieChartLayout {
	width: number
	height: number
	cx: number
	cy: number
	r: number
	inner: number
	total: number
	totalFormatted: string
	lx: number
	valueX: number
	pctX: number
	slices: PieSlice[]
}

function pieArcPath(ro: number, ri: number, startAngle: number, endAngle: number) {
	if (endAngle - startAngle >= Math.PI * 2 - 1e-4) {
		const outer = `M0,${round(-ro)}A${round(ro)},${round(ro)} 0 1 1 0,${round(ro)}A${round(ro)},${round(ro)} 0 1 1 0,${round(-ro)}Z`
		if (ri <= 0)
			return outer
		return `${outer}M0,${round(-ri)}A${round(ri)},${round(ri)} 0 1 0 0,${round(ri)}A${round(ri)},${round(ri)} 0 1 0 0,${round(-ri)}Z`
	}
	const x0 = round(ro * Math.cos(startAngle))
	const y0 = round(ro * Math.sin(startAngle))
	const x1 = round(ro * Math.cos(endAngle))
	const y1 = round(ro * Math.sin(endAngle))
	const large = endAngle - startAngle > Math.PI ? 1 : 0
	if (ri <= 0)
		return `M0,0L${x0},${y0}A${round(ro)},${round(ro)} 0 ${large} 1 ${x1},${y1}Z`
	const ix0 = round(ri * Math.cos(startAngle))
	const iy0 = round(ri * Math.sin(startAngle))
	const ix1 = round(ri * Math.cos(endAngle))
	const iy1 = round(ri * Math.sin(endAngle))
	return `M${x0},${y0}A${round(ro)},${round(ro)} 0 ${large} 1 ${x1},${y1}L${ix1},${iy1}A${round(ri)},${round(ri)} 0 ${large} 0 ${ix0},${iy0}Z`
}

export function buildPieChart(spec: ChartSpec, width = 720, height = 260): PieChartLayout {
	const key = spec.series[0]!.key
	const rows = spec.data.map((row, i) => ({
		i,
		label: chartRowLabel(row, spec.x),
		value: Math.max(0, chartRowNumber(row, key) ?? 0),
	}))
	const total = rows.reduce((sum, r) => sum + r.value, 0)
	const r = round(height / 2 - 10)
	const cx = round(r + 10)
	const cy = round(height / 2)
	const inner = spec.donut ? round(r * 0.62) : 0
	const rowH = 28
	const labelW = rows.length ? Math.max(...rows.map(row => estimateTextWidth(row.label, 13))) : 0
	const lx = round(cx + r + 56)
	const valueX = round(Math.min(width - 64, lx + 18 + labelW + 80))
	const pctX = round(Math.min(width - 4, valueX + 44))
	const ly0 = cy - rows.length * rowH / 2 + rowH / 2

	let angle = -Math.PI / 2
	const slices: PieSlice[] = rows.map((row, i) => {
		const sweep = total > 0 ? row.value / total * Math.PI * 2 : 0
		const start = angle
		const end = angle + sweep
		angle = end
		const color = spec.highlight && spec.highlight !== row.label
			? 'var(--mx-chart-muted)'
			: CHART_PALETTE[i % CHART_PALETTE.length]!
		return {
			index: i,
			path: sweep > 0 ? pieArcPath(r, inner, start, end) : '',
			color,
			label: row.label,
			value: row.value,
			formatted: formatChartValue(row.value, spec.format),
			pct: total ? `${Math.round(row.value / total * 100)}%` : '—',
			legendY: round(ly0 + i * rowH),
		}
	})

	return {
		width,
		height,
		cx,
		cy,
		r,
		inner,
		total,
		totalFormatted: formatChartValue(total, spec.format),
		lx,
		valueX,
		pctX,
		slices,
	}
}

export interface ScatterPoint {
	rowIndex: number
	seriesIndex: number
	cx: number
	cy: number
	color: string
	xText: string
	yText: string
	seriesName: string
}

export interface ScatterChartLayout {
	width: number
	height: number
	ml: number
	mb: number
	plotBottom: number
	yTicks: Array<{ y: number, label: string, zero: boolean }>
	xLabels: Array<{ x: number, y: number, label: string, rotate: boolean }>
	refs: Array<{ y: number, x1: number, x2: number, label: string }>
	points: ScatterPoint[]
}

export function buildScatterChart(spec: ChartSpec, width = 720, height = 300): ScatterChartLayout {
	const xs = spec.data.map(row => chartRowNumber(row, spec.x)).filter((v): v is number => v != null)
	let min = 0
	let max = 0
	for (const row of spec.data) {
		for (const s of spec.series) {
			const v = chartRowNumber(row, s.key)
			if (v == null)
				continue
			min = Math.min(min, v)
			max = Math.max(max, v)
		}
	}
	for (const r of spec.refs ?? [])
		max = Math.max(max, r.y)

	const yAxis = buildYAxis(min, max, spec.format, spec.y)
	const xMin = Math.min(...xs, 0)
	const xMax = Math.max(...xs, xMin + 1)
	const xAxis = niceScale(xMin, xMax, 5)
	const ml = round(yAxis.width)
	const mb = 28
	const plotBottom = height - mb
	const xOf = (v: number) => linearMap(v, xAxis.domain, [ml + 8, width - 16])
	const yOf = (v: number) => linearMap(v, yAxis.domain, [plotBottom, 12])

	const points: ScatterPoint[] = []
	for (let j = 0; j < spec.series.length; j++) {
		const s = spec.series[j]!
		const color = chartColorOf(spec, j)
		const sName = chartSeriesName(spec, j)
		for (let i = 0; i < spec.data.length; i++) {
			const row = spec.data[i]!
			const px = chartRowNumber(row, spec.x)
			const py = chartRowNumber(row, s.key)
			if (px == null || py == null)
				continue
			points.push({
				rowIndex: i,
				seriesIndex: j,
				cx: round(xOf(px)),
				cy: round(yOf(py)),
				color,
				xText: formatChartValue(px, { ...spec.format, unit: undefined }),
				yText: formatChartValue(py, spec.format),
				seriesName: sName,
			})
		}
	}

	return {
		width,
		height,
		ml,
		mb,
		plotBottom: round(plotBottom),
		yTicks: yAxis.ticks.map((t, i) => ({ y: round(yOf(t)), label: yAxis.labels[i]!, zero: t === 0 })),
		xLabels: filterXLabels(
			xAxis.ticks.map((t, i) => formatChartTick(t, undefined, i === xAxis.ticks.length - 1)),
			xAxis.ticks.map(t => xOf(t)),
			height - mb + 18,
			false,
		),
		refs: buildRefs(spec, yOf, ml, width - 8),
		points,
	}
}
