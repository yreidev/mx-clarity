<script setup lang="ts">
/**
 * 正文里的股票块（Lexical 的 stock）。行情由服务端取好、算好图（走势线、K 线的路径）写进属性，这里只画；
 * 浏览器不和行情服务通信。K 线上鼠标或手指移动时画十字线、上面换成那一根的数值；快照有 52 周区间条。
 * 涨跌按中文习惯：红涨绿跌。取不到时只写「行情暂不可用」
 */
const props = defineProps<{
	symbol: string
	variant?: 'snapshot' | 'kline'
	unavailable?: boolean
	name?: string
	exchange?: string
	currency?: string
	price?: number
	previousClose?: number
	dayHigh?: number
	dayLow?: number
	high52?: number
	low52?: number
	volume?: number
	asOf?: string
	open?: boolean
	spark?: string
	interval?: string
	from?: string
	to?: string
	chartWidth?: number
	chartHeight?: number
	up?: string
	down?: string
	wicks?: string
	/** EMA 路径数组的 JSON 字符串 */
	emas?: string
	low?: number
	high?: number
	/** 每一根的 [时间（秒）, 开, 高, 低, 收, 量]，JSON 字符串 */
	bars?: string
}>()

const timeZone = useSiteTimeZone()
const t = useT()
const locale = useUiLocale()
const intervals = computed<Record<string, string>>(() => ({ '5m': t('content.n5Minute'), '15m': t('content.n15Minute'), '1h': t('content.hourly'), '1d': t('content.daily') }))
const format = (value: number | undefined, digits = 2) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(locale.value, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '--'
const change = computed(() => props.price && props.previousClose ? props.price - props.previousClose : undefined)
const percent = computed(() => change.value !== undefined && props.previousClose ? change.value / props.previousClose * 100 : undefined)
const trend = computed(() => change.value === undefined ? '' : change.value >= 0 ? 'rise' : 'fall')
const dateOf = (value: string | undefined, kind: 'date' | 'full' = 'date') => value && Number.isFinite(Date.parse(value)) ? toZonedLocaleString(value, timeZone.value, kind, locale.value) : ''
const range = computed(() => props.from && props.to ? `${t('content.dateRange', { from: dateOf(props.from), to: dateOf(props.to) })}${props.interval ? ` · ${intervals.value[props.interval] ?? props.interval}` : ''}` : '')
const emaPaths = computed<string[]>(() => {
	try {
		const parsed = JSON.parse(props.emas ?? '[]')
		return Array.isArray(parsed) ? parsed.filter(path => typeof path === 'string' && /^[\d\s.MLVhZ-]*$/.test(path)) : []
	}
	catch {
		return []
	}
})
const loaded = computed(() => !props.unavailable && (props.variant === 'kline' ? Boolean(props.up || props.down) : typeof props.price === 'number'))

// —— K 线的十字线与悬停数值 ——
const barList = computed<number[][]>(() => {
	try {
		const parsed = JSON.parse(props.bars ?? '[]')
		return Array.isArray(parsed) ? parsed.filter((bar): bar is number[] => Array.isArray(bar) && bar.length === 6 && bar.every(value => typeof value === 'number' && Number.isFinite(value))) : []
	}
	catch {
		return []
	}
})
const hoverIndex = ref<number>()
const shown = computed(() => barList.value[hoverIndex.value ?? barList.value.length - 1])
const shownPrevious = computed(() => barList.value[(hoverIndex.value ?? barList.value.length - 1) - 1])
const slot = computed(() => (props.chartWidth ?? 600) / Math.max(1, barList.value.length))
function yOf(value: number) {
	const height = props.chartHeight ?? 220
	const span = (props.high ?? 0) - (props.low ?? 0) || 1
	return height - 4 - (value - (props.low ?? 0)) / span * (height - 8)
}
function onPoint(event: PointerEvent) {
	const svg = event.currentTarget as SVGSVGElement
	const rect = svg.getBoundingClientRect()
	if (!rect.width || !barList.value.length)
		return
	hoverIndex.value = Math.min(barList.value.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / rect.width * barList.value.length)))
}
const barDate = (bar: number[] | undefined) => bar ? dateOf(new Date(bar[0]! * 1000).toISOString(), props.interval === '1d' ? 'date' : 'full') : ''
const barChange = computed(() => shown.value && shownPrevious.value ? shown.value[4]! - shownPrevious.value[4]! : undefined)

// —— 快照的 52 周区间条：价格在区间里的位置 ——
const range52 = computed(() => props.price && props.low52 && props.high52 && props.high52 > props.low52 ? Math.min(100, Math.max(0, (props.price - props.low52) / (props.high52 - props.low52) * 100)) : undefined)
</script>

<template>
<figure class="stock-block card" :class="trend">
	<figcaption class="stock-head">
		<span class="stock-symbol">{{ symbol }}</span>
		<span v-if="name" class="stock-name">{{ name }}</span>
		<span v-if="exchange" class="stock-exchange">{{ exchange }}</span>
	</figcaption>

	<p v-if="!loaded" class="stock-empty">
		{{ variant === 'kline' && range ? t('content.quoteUnavailable2', { range }) : t('content.quoteUnavailable') }}
	</p>

	<template v-else-if="variant === 'kline'">
		<p class="stock-range">
			{{ range }} · {{ t('content.range', { low: format(low), high: format(high) }) }} {{ currency }}
		</p>
		<div v-if="shown" class="stock-bar-info" aria-live="polite">
			<span class="stock-bar-close" :class="barChange === undefined ? '' : barChange >= 0 ? 'rise' : 'fall'">{{ format(shown[4]) }}</span>
			<span>{{ t('content.open', { value: format(shown[1]) }) }}</span>
			<span>{{ t('content.high', { value: format(shown[2]) }) }}</span>
			<span>{{ t('content.low', { value: format(shown[3]) }) }}</span>
			<span v-if="shown[5]">{{ t('content.vol', { value: format(shown[5], 0) }) }}</span>
			<span class="stock-bar-date">{{ barDate(shown) }}</span>
		</div>
		<div class="stock-kline-wrap">
			<svg
				class="stock-kline"
				:viewBox="`0 0 ${chartWidth} ${chartHeight}`"
				role="img"
				:aria-label="t('content.candlestickChart', { symbol, range })"
				preserveAspectRatio="none"
				@pointermove="onPoint"
				@pointerdown="onPoint"
				@pointerleave="hoverIndex = undefined"
			>
				<path class="wick" :d="wicks" />
				<path class="up" :d="up" />
				<path class="down" :d="down" />
				<path v-for="(line, index) in emaPaths" :key="index" class="ema" :class="`ema-${index}`" :d="line" />
				<g v-if="hoverIndex !== undefined && shown" class="crosshair">
					<line :x1="slot * hoverIndex + slot / 2" :x2="slot * hoverIndex + slot / 2" y1="0" :y2="chartHeight" />
					<line x1="0" :x2="chartWidth" :y1="yOf(shown[4]!)" :y2="yOf(shown[4]!)" />
				</g>
			</svg>
			<span class="stock-axis top">{{ format(high) }}</span>
			<span class="stock-axis bottom">{{ format(low) }}</span>
		</div>
		<p v-if="barList.length" class="stock-dates">
			<span>{{ barDate(barList[0]) }}</span>
			<span>{{ barDate(barList.at(-1)) }}</span>
		</p>
	</template>

	<template v-else>
		<div class="stock-quote">
			<span class="stock-price">{{ format(price) }} <small>{{ currency }}</small></span>
			<span v-if="change !== undefined" class="stock-change">
				{{ t('content.changeWithPercent', { change: `${change >= 0 ? '+' : ''}${format(change)}`, percent: `${percent! >= 0 ? '+' : ''}${format(percent)}` }) }}
			</span>
			<svg v-if="spark" class="stock-spark" viewBox="0 0 120 36" aria-hidden="true">
				<path :d="spark" />
			</svg>
		</div>
		<dl class="stock-facts">
			<div><dt>{{ t('content.dayRange') }}</dt><dd>{{ format(dayLow) }} – {{ format(dayHigh) }}</dd></div>
			<div><dt>{{ t('content.n52Week') }}</dt><dd>{{ format(low52) }} – {{ format(high52) }}</dd></div>
			<div><dt>{{ t('content.volume') }}</dt><dd>{{ format(volume, 0) }}</dd></div>
		</dl>
		<div v-if="range52 !== undefined" class="stock-52w" role="img" :aria-label="t('content.price52Week', { percent: Math.round(range52) })">
			<span class="stock-52w-track"><span class="stock-52w-mark" :style="{ left: `${range52}%` }" /></span>
		</div>
		<p v-if="asOf" class="stock-time">
			<span class="stock-state" :class="{ open }" />{{ open ? t('content.marketOpen') : t('content.marketClosed') }} · {{ dateOf(asOf, 'full') }}
		</p>
	</template>
</figure>
</template>

<style lang="scss" scoped>
.stock-bar-info {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.2em 0.8em;
	margin: 0.3em 0;
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-2);
}

.stock-bar-close {
	font-size: 1.3em;
	font-weight: 700;
	color: var(--c-text);

	&.rise {
		color: var(--stock-rise);
	}

	&.fall {
		color: var(--stock-fall);
	}
}

.stock-bar-date {
	margin-inline-start: auto;
	color: var(--c-text-3);
}

.stock-kline-wrap {
	position: relative;

	.crosshair line {
		stroke: var(--c-text-3);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
}

.stock-axis {
	position: absolute;
	right: 0.2em;
	font-size: 0.7em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
	pointer-events: none;

	&.top {
		top: 0;
	}

	&.bottom {
		bottom: 0.2em;
	}
}

.stock-dates {
	display: flex;
	justify-content: space-between;
	margin: 0.2em 0 0;
	font-size: 0.75em;
	color: var(--c-text-3);
}

.stock-52w {
	margin: 0.4em 0 0.2em;
}

.stock-52w-track {
	display: block;
	position: relative;
	height: 4px;
	border-radius: 2px;
	background: linear-gradient(to right, var(--stock-fall), var(--c-border), var(--stock-rise));
}

.stock-52w-mark {
	position: absolute;
	top: 50%;
	width: 0.6em;
	height: 0.6em;
	border: 2px solid var(--c-bg);
	border-radius: 50%;
	background-color: var(--c-text);
	transform: translate(-50%, -50%);
}

.stock-state {
	display: inline-block;
	width: 0.5em;
	height: 0.5em;
	margin-inline-end: 0.3em;
	border-radius: 50%;
	background-color: var(--c-text-3);
	vertical-align: 0.1em;

	&.open {
		background-color: var(--c-success);
	}
}

.stock-block {
	--stock-rise: #D33;
	--stock-fall: #2A9D5C;

	width: 32rem;
	max-width: 100%;
	margin: 1.5em auto;
	padding: 0.9em 1.1em;
	font-size: 0.9em;
}

.stock-head {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.3em 0.6em;
}

.stock-symbol {
	font-weight: 700;
}

.stock-name, .stock-exchange, .stock-time, .stock-range, .stock-empty {
	color: var(--c-text-2);
}

.stock-exchange, .stock-time, .stock-range {
	font-size: 0.85em;
}

.stock-quote {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3em 1em;
	margin: 0.5em 0;
}

.stock-price {
	font-size: 1.6em;
	font-variant-numeric: tabular-nums;
	font-weight: 700;

	small {
		font-size: 0.5em;
		font-weight: normal;
		color: var(--c-text-3);
	}
}

.stock-change {
	font-variant-numeric: tabular-nums;

	.rise & {
		color: var(--stock-rise);
	}

	.fall & {
		color: var(--stock-fall);
	}
}

.stock-spark {
	width: 7.5em;
	height: 2.25em;
	margin-inline-start: auto;

	path {
		fill: none;
		stroke: currentcolor;
		stroke-width: 1.5;
	}

	.rise & {
		color: var(--stock-rise);
	}

	.fall & {
		color: var(--stock-fall);
	}
}

.stock-facts {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3em 1.5em;
	margin: 0;
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;

	div {
		display: flex;
		gap: 0.4em;
	}

	dt {
		color: var(--c-text-3);
	}

	dd {
		margin: 0;
	}
}

.stock-kline {
	width: 100%;
	height: 12em;
	margin-top: 0.5em;
	touch-action: pan-y;

	.wick {
		fill: none;
		stroke: var(--c-text-3);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.up {
		fill: var(--stock-rise);
	}

	.down {
		fill: var(--stock-fall);
	}

	.ema {
		fill: none;
		stroke: var(--c-primary);
		stroke-width: 1.2;
		vector-effect: non-scaling-stroke;
	}

	.ema-1 {
		stroke: #E6A23C;
	}
}
</style>
