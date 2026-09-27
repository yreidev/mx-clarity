/**
 * 正文里的股票块取数：core 的内置云函数 `stock_quote`（Twelve Data）、`stock_bars`（Polygon）。纯模块，由服务端调用。
 *
 * 函数里的错误到 HTTP 层都是 500，message 带着上游原文（「Twelve Data: …」「no bars for …」）：一概不给读者看，
 * 失败就当作「行情暂不可用」。数值一律过 `Number.isFinite`，文字纯文本限长
 */
import type { Bar } from './charts'
import type { MxClient } from './client'
import { downsample, sparklinePath } from './charts'
import { plainOf } from './rich-blocks'

export interface StockQuote {
	name: string
	exchange: string
	currency: string
	price: number
	previousClose: number
	dayHigh: number
	dayLow: number
	high52: number
	low52: number
	volume: number
	/** 行情时间（ISO） */
	asOf?: string
	open: boolean
	/** 走势小图的路径 */
	spark: string
}

export interface StockBars {
	name: string
	currency: string
	bars: (Bar & { time: number, volume: number })[]
}

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

function objectOf(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function stockQuoteFrom(raw: unknown): StockQuote | undefined {
	const data = objectOf(raw)
	const price = num(data.price)
	if (!price)
		return undefined
	const sparkline = (Array.isArray(data.sparkline) ? data.sparkline : []).map(point => num(objectOf(point).close)).filter(Boolean)
	const asOf = num(data.asOf)
	return {
		name: plainOf(data.longName, 80) || plainOf(data.shortName, 80),
		exchange: plainOf(data.exchange, 20),
		currency: plainOf(data.currency, 10),
		price,
		previousClose: num(data.previousClose),
		dayHigh: num(data.dayHigh),
		dayLow: num(data.dayLow),
		high52: num(data.fiftyTwoWeekHigh),
		low52: num(data.fiftyTwoWeekLow),
		volume: num(data.volume),
		asOf: asOf > 0 ? new Date(asOf * 1000).toISOString() : undefined,
		open: data.marketState === 'regular',
		spark: sparklinePath(downsample(sparkline, 200)),
	}
}

export function stockBarsFrom(raw: unknown): StockBars | undefined {
	const data = objectOf(raw)
	const meta = objectOf(data.meta)
	const bars = (Array.isArray(data.bars) ? data.bars : []).flatMap((item) => {
		const bar = objectOf(item)
		const values = { open: num(bar.open), high: num(bar.high), low: num(bar.low), close: num(bar.close), time: num(bar.timestamp), volume: num(bar.volume) }
		return values.high && values.low && values.close ? [values] : []
	})
	if (bars.length < 2)
		return undefined
	return {
		name: plainOf(meta.longName, 80) || plainOf(meta.shortName, 80),
		currency: plainOf(meta.currency, 10),
		bars: downsample(bars, 500),
	}
}

/** 快照；代码已按正则校验过 */
export async function loadStockQuote(client: MxClient, symbol: string) {
	return stockQuoteFrom(await client.proxy('fn')('built-in')('stock_quote').get<unknown>({ params: { symbol } }))
}

export async function loadStockBars(client: MxClient, symbol: string, interval: string, from: string, to: string) {
	return stockBarsFrom(await client.proxy('fn')('built-in')('stock_bars').get<unknown>({ params: { symbol, interval, from, to } }))
}
