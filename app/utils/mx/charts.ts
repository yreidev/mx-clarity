/**
 * 行情与地图的静态图：在服务端算好 SVG 的路径字符串，交给组件原样画，浏览器不取任何第三方数据。纯模块。
 * 输入都已校验成有限数；输出只有数字拼成的路径，没有文字，不会带出别的东西。
 */

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
