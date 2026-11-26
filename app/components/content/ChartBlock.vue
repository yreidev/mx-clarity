<script setup lang="ts">
import {
	buildBarChart,
	buildLineChart,
	buildPieChart,
	buildScatterChart,
	chartColorOf,
	chartRowLabel,
	chartRowNumber,
	chartSeriesName,
	formatChartValue,
} from '~~/app/utils/mx/charts'
import { parseChartSpec } from '~~/app/utils/mx/rich-blocks'

const props = defineProps<{
	spec: string
}>()

const t = useT()

const parsed = computed(() => parseChartSpec(props.spec))
const view = ref<'chart' | 'table'>('chart')
const hoverRow = ref<number | null>(null)
const hoverScatter = ref<{ rowIndex: number, seriesIndex: number } | null>(null)

const isEmpty = computed(() => !parsed.value || parsed.value.data.length === 0)
const showTable = computed(() => view.value === 'table' && !isEmpty.value)

const barLayout = computed(() => parsed.value?.type === 'bar' ? buildBarChart(parsed.value) : undefined)
const lineLayout = computed(() => parsed.value && (parsed.value.type === 'line' || parsed.value.type === 'area') ? buildLineChart(parsed.value) : undefined)
const pieLayout = computed(() => parsed.value?.type === 'pie' ? buildPieChart(parsed.value) : undefined)
const scatterLayout = computed(() => parsed.value?.type === 'scatter' ? buildScatterChart(parsed.value) : undefined)

const showLegend = computed(() => {
	const s = parsed.value
	if (!s || s.type === 'pie' || s.series.length < 2)
		return false
	return s.type === 'bar' || s.type === 'scatter' || Boolean(s.stacked) || s.series.length > 3
})

const pieCenter = computed(() => {
	const p = pieLayout.value
	if (!p)
		return { value: '', label: '' }
	const active = hoverRow.value != null ? p.slices[hoverRow.value] : undefined
	if (!active)
		return { value: p.totalFormatted, label: t('content.chartTotal') }
	return { value: active.formatted, label: `${active.label} · ${active.pct}` }
})

const tooltip = computed(() => {
	const s = parsed.value
	if (!s || showTable.value || isEmpty.value)
		return undefined

	if (s.type === 'bar' && barLayout.value && hoverRow.value != null) {
		const b = barLayout.value
		const i = hoverRow.value
		const row = s.data[i]
		const cx = b.centers[i]
		if (!row || cx === undefined)
			return undefined
		const rows = (s.stacked ? [...s.series.keys()].reverse() : [...s.series.keys()]).map(j => ({
			color: chartColorOf(s, j),
			label: chartSeriesName(s, j),
			value: formatChartValue(chartRowNumber(row, s.series[j]!.key), s.format),
		}))
		if (s.stacked && s.series.length > 1) {
			const total = s.series.reduce((sum, se) => sum + (chartRowNumber(row, se.key) ?? 0), 0)
			rows.push({ color: 'transparent', label: t('content.chartTotal'), value: formatChartValue(total, s.format) })
		}
		const right = cx > b.ml + (b.width - b.ml) / 2
		return {
			left: `${(cx + (right ? -b.band / 4 : b.band / 4)) / b.width * 100}%`,
			top: `${12 / b.height * 100}%`,
			side: right ? 'left' : 'right',
			title: chartRowLabel(row, s.x),
			rows,
		}
	}

	if ((s.type === 'line' || s.type === 'area') && lineLayout.value && hoverRow.value != null) {
		const l = lineLayout.value
		const i = hoverRow.value
		const row = s.data[i]
		const cx = l.xCenters[i]
		if (!row || cx === undefined)
			return undefined
		const order = s.stacked
			? [...s.series.keys()].reverse()
			: [...s.series.keys()].sort((a, b) => (chartRowNumber(row, s.series[b]!.key) ?? -Infinity) - (chartRowNumber(row, s.series[a]!.key) ?? -Infinity))
		const rows = order.map(j => ({
			color: chartColorOf(s, j),
			label: chartSeriesName(s, j),
			value: formatChartValue(chartRowNumber(row, s.series[j]!.key), s.format),
		}))
		if (s.stacked && s.series.length > 1) {
			const total = s.series.reduce((sum, se) => sum + (chartRowNumber(row, se.key) ?? 0), 0)
			rows.push({ color: 'transparent', label: t('content.chartTotal'), value: formatChartValue(total, s.format) })
		}
		const right = cx > l.ml + l.plotW / 2
		return {
			left: `${cx / l.width * 100}%`,
			top: `${16 / l.height * 100}%`,
			side: right ? 'left' : 'right',
			title: chartRowLabel(row, s.x),
			rows,
		}
	}

	if (s.type === 'scatter' && scatterLayout.value && hoverScatter.value) {
		const sc = scatterLayout.value
		const pt = sc.points.find(p => p.rowIndex === hoverScatter.value!.rowIndex && p.seriesIndex === hoverScatter.value!.seriesIndex)
		if (!pt)
			return undefined
		const right = pt.cx > sc.ml + (sc.width - sc.ml) / 2
		return {
			left: `${pt.cx / sc.width * 100}%`,
			top: `${pt.cy / sc.height * 100}%`,
			side: right ? 'left' : 'right',
			title: `${s.xLabel || s.x} ${pt.xText}`,
			rows: [{ color: pt.color, label: pt.seriesName, value: pt.yText }],
		}
	}

	return undefined
})

function onLinePointerMove(event: PointerEvent) {
	const l = lineLayout.value
	const n = parsed.value?.data.length ?? 0
	if (!l || !n)
		return
	const target = event.currentTarget as SVGRectElement | null
	const svg = target?.ownerSVGElement
	if (!svg)
		return
	const rect = svg.getBoundingClientRect()
	const px = (event.clientX - rect.left) * l.width / rect.width
	const idx = n === 1 ? 0 : Math.round((px - l.ml) / l.plotW * (n - 1))
	hoverRow.value = Math.max(0, Math.min(n - 1, idx))
}
</script>

<template>
<figure v-if="parsed" class="mx-chart" :aria-label="parsed.title || t('content.chart')">
	<div v-if="parsed.title || parsed.subtitle || !isEmpty" class="chart-head">
		<div class="chart-heading">
			<div v-if="parsed.title" class="chart-title">
				{{ parsed.title }}
			</div>
			<div v-if="parsed.subtitle" class="chart-subtitle">
				{{ parsed.subtitle }}
			</div>
		</div>
		<button
			v-if="!isEmpty"
			type="button"
			class="chart-toggle"
			:aria-pressed="showTable"
			@click="view = showTable ? 'chart' : 'table'"
		>
			<Icon :name="showTable ? 'ph:chart-bar-bold' : 'ph:table-bold'" />
			<span>{{ showTable ? t('content.chartViewChart') : t('content.chartViewData') }}</span>
		</button>
	</div>

	<div v-if="showLegend && !showTable" class="chart-legend">
		<span v-for="(se, j) in parsed.series" :key="se.key" class="chart-legend-item">
			<i
				:class="parsed.type === 'line' ? 'chart-swatch-line' : 'chart-swatch'"
				:style="{ backgroundColor: chartColorOf(parsed, j) }"
			/>
			<span>{{ chartSeriesName(parsed, j) }}</span>
		</span>
	</div>

	<div v-if="isEmpty" class="chart-empty">
		<div class="chart-empty-lines" aria-hidden="true">
			<div v-for="i in 4" :key="i" class="chart-empty-line" />
		</div>
		<span class="chart-empty-label">{{ t('content.chartNoData') }}</span>
	</div>

	<div v-else-if="showTable" class="chart-table-wrap">
		<table class="chart-table">
			<thead>
				<tr>
					<th scope="col">
						{{ parsed.xLabel || parsed.x }}
					</th>
					<th v-for="(se, j) in parsed.series" :key="se.key" scope="col">
						{{ chartSeriesName(parsed, j) }}
					</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="(row, i) in parsed.data" :key="i">
					<td>{{ chartRowLabel(row, parsed.x) }}</td>
					<td v-for="se in parsed.series" :key="se.key">
						{{ formatChartValue(chartRowNumber(row, se.key), { ...parsed.format, compact: false }) }}
					</td>
				</tr>
			</tbody>
		</table>
	</div>

	<div v-else class="chart-plot">
		<!-- 柱状图 -->
		<svg v-if="barLayout" class="chart-svg" :viewBox="`0 0 ${barLayout.width} ${barLayout.height}`" aria-hidden="true">
			<rect
				v-if="hoverRow != null && barLayout.centers[hoverRow] != null"
				class="chart-hover-wash"
				:x="barLayout.centers[hoverRow]! - barLayout.band / 2 + 4"
				:y="12"
				:width="Math.max(0, barLayout.band - 8)"
				:height="Math.max(0, barLayout.plotBottom - 12)"
				rx="4"
			/>
			<g v-for="(tick, idx) in barLayout.yTicks" :key="`y-${idx}`">
				<line
					:class="tick.zero ? 'chart-base-line' : 'chart-grid-line'"
					:x1="barLayout.ml"
					:x2="barLayout.width - 8"
					:y1="tick.y"
					:y2="tick.y"
				/>
				<text class="chart-tick" text-anchor="end" :x="barLayout.ml - 8" :y="tick.y + 4">{{ tick.label }}</text>
			</g>
			<g v-for="(refLine, idx) in barLayout.refs" :key="`ref-${idx}`">
				<line class="chart-ref-line" :x1="refLine.x1" :x2="refLine.x2" :y1="refLine.y" :y2="refLine.y" />
				<text v-if="refLine.label" class="chart-ref-label" text-anchor="end" :x="refLine.x2 - 2" :y="refLine.y - 4">{{ refLine.label }}</text>
			</g>
			<g v-for="bar in barLayout.bars" :key="`${bar.rowIndex}-${bar.seriesIndex}`">
				<path :d="bar.path" :fill="bar.color" />
				<text v-if="bar.valueLabel" class="chart-value-label" text-anchor="middle" :x="bar.xCenter" :y="bar.valueY">{{ bar.valueLabel }}</text>
			</g>
			<text
				v-for="(xl, idx) in barLayout.xLabels"
				:key="`x-${idx}`"
				class="chart-x-label"
				:text-anchor="xl.rotate ? 'end' : 'middle'"
				:transform="xl.rotate ? `rotate(-38 ${xl.x} ${xl.y - 4})` : undefined"
				:x="xl.x"
				:y="xl.y"
			>
				{{ xl.label }}
			</text>
			<rect
				v-for="(cx, i) in barLayout.centers"
				:key="`hit-${i}`"
				fill="transparent"
				:x="cx - barLayout.band / 2"
				:y="12"
				:width="barLayout.band"
				:height="Math.max(0, barLayout.plotBottom - 12)"
				@pointerenter="hoverRow = i"
				@pointerleave="hoverRow = null"
			/>
		</svg>

		<!-- 折线图 / 面积图 -->
		<svg v-else-if="lineLayout" class="chart-svg" :viewBox="`0 0 ${lineLayout.width} ${lineLayout.height}`" aria-hidden="true">
			<g v-for="(tick, idx) in lineLayout.yTicks" :key="`y-${idx}`">
				<line
					:class="tick.zero ? 'chart-base-line' : 'chart-grid-line'"
					:x1="lineLayout.ml"
					:x2="lineLayout.ml + lineLayout.plotW"
					:y1="tick.y"
					:y2="tick.y"
				/>
				<text class="chart-tick" text-anchor="end" :x="lineLayout.ml - 8" :y="tick.y + 4">{{ tick.label }}</text>
			</g>
			<g v-for="(refLine, idx) in lineLayout.refs" :key="`ref-${idx}`">
				<line class="chart-ref-line" :x1="refLine.x1" :x2="refLine.x2" :y1="refLine.y" :y2="refLine.y" />
				<text v-if="refLine.label" class="chart-ref-label" text-anchor="end" :x="refLine.x2 - 2" :y="refLine.y - 4">{{ refLine.label }}</text>
			</g>
			<g v-for="s in lineLayout.series" :key="`s-${s.seriesIndex}`" :class="{ dimmed: s.dimmed }">
				<path
					v-for="(ap, idx) in s.areaPaths"
					:key="`a-${idx}`"
					:d="ap"
					:fill="s.color"
					class="chart-area-fill"
				/>
				<path
					v-for="(lp, idx) in s.linePaths"
					:key="`l-${idx}`"
					:d="lp"
					fill="none"
					:stroke="s.color"
					:stroke-width="s.highlighted ? 2.6 : 2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
				<circle
					v-if="s.linePaths.length === 1 && s.points.length === 1 && s.points[0]?.value != null"
					:cx="s.points[0]!.cx"
					:cy="s.points[0]!.cy"
					r="4"
					:fill="s.color"
				/>
				<text v-if="s.endLabel" class="chart-end-label" :x="s.endLabel.x" :y="s.endLabel.y + 4" :fill="s.color">
					{{ s.endLabel.name }} {{ s.endLabel.value }}
				</text>
			</g>
			<g v-if="hoverRow != null && lineLayout.xCenters[hoverRow] != null">
				<line
					class="chart-crosshair"
					:x1="lineLayout.xCenters[hoverRow]"
					:x2="lineLayout.xCenters[hoverRow]"
					:y1="12"
					:y2="lineLayout.plotBottom"
				/>
				<template v-for="s in lineLayout.series" :key="`pt-${s.seriesIndex}`">
					<circle
						v-if="s.points[hoverRow]?.value != null"
						class="chart-active-dot"
						:cx="s.points[hoverRow]!.cx"
						:cy="s.points[hoverRow]!.cy"
						r="4"
						:fill="s.color"
					/>
				</template>
			</g>
			<text
				v-for="(xl, idx) in lineLayout.xLabels"
				:key="`x-${idx}`"
				class="chart-x-label"
				text-anchor="middle"
				:x="xl.x"
				:y="xl.y"
			>
				{{ xl.label }}
			</text>
			<rect
				fill="transparent"
				:x="lineLayout.ml"
				:y="12"
				:width="lineLayout.plotW"
				:height="Math.max(0, lineLayout.plotBottom - 12)"
				@pointermove="onLinePointerMove"
				@pointerleave="hoverRow = null"
			/>
		</svg>

		<!-- 饼图 / 环形图 -->
		<div v-else-if="pieLayout" class="chart-pie-wrap">
			<svg class="chart-pie-svg" viewBox="0 0 260 260" aria-hidden="true">
				<g :transform="`translate(${pieLayout.cx} ${pieLayout.cy})`">
					<path
						v-for="slice in pieLayout.slices"
						:key="slice.index"
						class="chart-pie-slice"
						:d="slice.path"
						:fill="slice.color"
						:fill-rule="pieLayout.inner > 0 ? 'evenodd' : undefined"
						:style="{ opacity: hoverRow == null || hoverRow === slice.index ? 1 : 0.3 }"
						@pointerenter="hoverRow = slice.index"
						@pointerleave="hoverRow = null"
					/>
					<template v-if="pieLayout.inner > 0">
						<text class="chart-pie-total" text-anchor="middle" y="2">{{ pieCenter.value }}</text>
						<text class="chart-tick" text-anchor="middle" y="22">{{ pieCenter.label }}</text>
					</template>
				</g>
			</svg>
			<ul class="chart-pie-list">
				<li
					v-for="slice in pieLayout.slices"
					:key="slice.index"
					:class="{ dimmed: hoverRow != null && hoverRow !== slice.index }"
					@pointerenter="hoverRow = slice.index"
					@pointerleave="hoverRow = null"
				>
					<i class="chart-swatch" :style="{ backgroundColor: slice.color }" />
					<span class="chart-pie-name">{{ slice.label }}</span>
					<span class="chart-pie-val">{{ slice.formatted }}</span>
					<span class="chart-pie-pct">{{ slice.pct }}</span>
				</li>
			</ul>
		</div>

		<!-- 散点图 -->
		<svg v-else-if="scatterLayout" class="chart-svg" :viewBox="`0 0 ${scatterLayout.width} ${scatterLayout.height}`" aria-hidden="true">
			<g v-for="(tick, idx) in scatterLayout.yTicks" :key="`y-${idx}`">
				<line
					:class="tick.zero ? 'chart-base-line' : 'chart-grid-line'"
					:x1="scatterLayout.ml"
					:x2="scatterLayout.width - 8"
					:y1="tick.y"
					:y2="tick.y"
				/>
				<text class="chart-tick" text-anchor="end" :x="scatterLayout.ml - 8" :y="tick.y + 4">{{ tick.label }}</text>
			</g>
			<g v-for="(refLine, idx) in scatterLayout.refs" :key="`ref-${idx}`">
				<line class="chart-ref-line" :x1="refLine.x1" :x2="refLine.x2" :y1="refLine.y" :y2="refLine.y" />
				<text v-if="refLine.label" class="chart-ref-label" text-anchor="end" :x="refLine.x2 - 2" :y="refLine.y - 4">{{ refLine.label }}</text>
			</g>
			<text
				v-for="(xl, idx) in scatterLayout.xLabels"
				:key="`x-${idx}`"
				class="chart-x-label"
				text-anchor="middle"
				:x="xl.x"
				:y="xl.y"
			>
				{{ xl.label }}
			</text>
			<circle
				v-for="pt in scatterLayout.points"
				:key="`${pt.seriesIndex}-${pt.rowIndex}`"
				class="chart-scatter-dot"
				:cx="pt.cx"
				:cy="pt.cy"
				:r="hoverScatter?.rowIndex === pt.rowIndex && hoverScatter?.seriesIndex === pt.seriesIndex ? 6 : 4.5"
				:fill="pt.color"
				:fill-opacity="hoverScatter?.rowIndex === pt.rowIndex && hoverScatter?.seriesIndex === pt.seriesIndex ? 1 : 0.75"
				@pointerenter="hoverScatter = { rowIndex: pt.rowIndex, seriesIndex: pt.seriesIndex }"
				@pointerleave="hoverScatter = null"
			/>
		</svg>

		<div
			v-if="tooltip"
			aria-hidden="true"
			class="chart-tooltip"
			:class="tooltip.side"
			:style="{ left: tooltip.left, top: tooltip.top }"
		>
			<div v-if="tooltip.title" class="chart-tooltip-title">
				{{ tooltip.title }}
			</div>
			<div v-for="row in tooltip.rows" :key="row.label" class="chart-tooltip-row">
				<i class="chart-tooltip-key" :style="{ backgroundColor: row.color }" />
				<span class="chart-tooltip-val">{{ row.value }}</span>
				<span class="chart-tooltip-label">{{ row.label }}</span>
			</div>
		</div>
	</div>

	<figcaption v-if="parsed.note || parsed.source" class="chart-footer">
		<span v-if="parsed.note">{{ parsed.note }}</span>
		<span v-if="parsed.source" class="chart-source">{{ t('content.chartSource', { source: parsed.source }) }}</span>
	</figcaption>
</figure>

<p v-else class="mx-unsupported">
	<em>{{ t('content.cantShownHere', { what: t('content.chart') }) }}</em>
</p>
</template>

<style scoped>
.mx-chart {
	--mx-chart-1: rgb(37 99 235);
	--mx-chart-2: #0D9488;
	--mx-chart-3: #D97706;
	--mx-chart-4: #7C3AED;
	--mx-chart-5: #E11D48;
	--mx-chart-6: #65A30D;
	--mx-chart-muted: var(--c-text-3);

	margin: 1.5em 0;
	padding: 0.9rem 1rem;
	border: 1px solid var(--c-border);
	border-radius: 0.75rem;
	background-color: var(--c-bg-1, var(--c-bg));
}

:global(.dark) .mx-chart {
	--mx-chart-1: #60A5FA;
	--mx-chart-2: #2DD4BF;
	--mx-chart-3: #FBBF24;
	--mx-chart-4: #A78BFA;
	--mx-chart-5: #FB7185;
	--mx-chart-6: #A3E635;
}

.chart-head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.75rem;
	margin-bottom: 0.75rem;
}

.chart-heading {
	min-width: 0;
}

.chart-title {
	font-size: 0.95rem;
	font-weight: 600;
	line-height: 1.4;
	color: var(--c-text);
}

.chart-subtitle {
	margin-top: 0.15rem;
	font-size: 0.82rem;
	line-height: 1.4;
	color: var(--c-text-2);
}

.chart-toggle {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	gap: 0.35em;
	padding: 0.3em 0.65em;
	border: 1px solid var(--c-border);
	border-radius: 0.45rem;
	background-color: var(--c-bg-2);
	font-size: 0.78rem;
	color: var(--c-text-2);
	transition: color 0.15s, border-color 0.15s;

	&:hover {
		border-color: var(--c-primary);
		color: var(--c-text);
	}
}

.chart-legend {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem 1rem;
	margin-bottom: 0.5rem;
	font-size: 0.78rem;
	color: var(--c-text-2);
}

.chart-legend-item {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
}

.chart-swatch {
	display: inline-block;
	flex-shrink: 0;
	width: 0.625rem;
	height: 0.625rem;
	border-radius: 2px;
}

.chart-swatch-line {
	display: inline-block;
	flex-shrink: 0;
	width: 0.85rem;
	height: 2.5px;
	border-radius: 2px;
}

.chart-plot {
	position: relative;
}

.chart-svg {
	display: block;
	overflow: visible;
	width: 100%;
	height: auto;
	font-variant-numeric: tabular-nums;
}

.chart-grid-line {
	stroke: var(--c-border);
	stroke-dasharray: 2 3;
	stroke-width: 1;
}

.chart-base-line {
	stroke: var(--c-text-3);
	stroke-width: 1;
}

.chart-ref-line {
	stroke: var(--c-text-2);
	stroke-dasharray: 4 3;
	stroke-width: 1;
}

.chart-ref-label,
.chart-tick,
.chart-x-label,
.chart-value-label {
	fill: var(--c-text-2);
	font-size: 11px;
}

.chart-x-label {
	font-size: 12px;
}

.chart-end-label {
	font-size: 12px;
	font-weight: 500;
}

.chart-area-fill {
	fill-opacity: 0.16;
}

.dimmed {
	opacity: 0.45;
}

.chart-hover-wash {
	fill: var(--c-bg-soft, var(--c-bg-2));
	opacity: 0.7;
}

.chart-crosshair {
	stroke: var(--c-text-3);
	stroke-dasharray: 2 2;
	stroke-width: 1;
}

.chart-active-dot,
.chart-scatter-dot,
.chart-pie-slice {
	stroke: var(--c-bg-1, var(--c-bg));
	stroke-width: 1.5;
	transition: opacity 0.15s;
}

.chart-pie-wrap {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: 1.25rem 2rem;
	padding: 0.25rem 0;
}

.chart-pie-svg {
	width: min(220px, 100%);
	height: auto;
}

.chart-pie-total {
	fill: var(--c-text);
	font-size: 22px;
	font-weight: 600;
}

.chart-pie-list {
	display: flex;
	flex: 1 1 220px;
	flex-direction: column;
	gap: 0.45rem;
	max-width: 360px;
	margin: 0;
	padding: 0;
	font-size: 0.85rem;
	list-style: none;
	font-variant-numeric: tabular-nums;

	> li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0.4rem;
		border-radius: 0.35rem;
		transition: opacity 0.15s, background-color 0.15s;

		&:hover {
			background-color: var(--c-bg-2);
		}
	}
}

.chart-pie-name {
	flex: 1;
	overflow: hidden;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: var(--c-text-2);
}

.chart-pie-val {
	font-weight: 600;
	color: var(--c-text);
}

.chart-pie-pct {
	min-width: 3ch;
	text-align: end;
	color: var(--c-text-3);
}

.chart-tooltip {
	position: absolute;
	min-width: 120px;
	padding: 0.4rem 0.55rem;
	border: 1px solid var(--c-border);
	border-radius: 0.45rem;
	box-shadow: 0 4px 14px var(--ld-shadow);
	background-color: var(--c-bg-1, var(--c-bg));
	font-size: 0.78rem;
	pointer-events: none;
	z-index: 2;
	font-variant-numeric: tabular-nums;

	&.right {
		transform: translateX(12px);
	}

	&.left {
		transform: translateX(calc(-100% - 12px));
	}
}

.chart-tooltip-title {
	margin-bottom: 0.2rem;
	font-weight: 600;
	color: var(--c-text);
}

.chart-tooltip-row {
	display: flex;
	align-items: center;
	gap: 0.35rem;
}

.chart-tooltip-key {
	width: 0.5rem;
	height: 0.5rem;
	border-radius: 2px;
}

.chart-tooltip-val {
	font-weight: 600;
	color: var(--c-text);
}

.chart-tooltip-label {
	color: var(--c-text-2);
}

.chart-table-wrap {
	overflow-x: auto;
}

.chart-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 0.84rem;
	font-variant-numeric: tabular-nums;

	th, td {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--c-border);
		text-align: end;
	}

	th {
		font-weight: 500;
		color: var(--c-text-2);
	}

	th:first-child, td:first-child {
		text-align: start;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}
}

.chart-empty {
	display: grid;
	place-items: center;
	position: relative;
	height: 160px;
}

.chart-empty-lines {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	position: absolute;
	inset: 1rem 0;
}

.chart-empty-line {
	height: 1px;
	background-color: var(--c-border);
}

.chart-empty-label {
	position: relative;
	padding: 0.25rem 0.75rem;
	background-color: var(--c-bg-1, var(--c-bg));
	font-size: 0.85rem;
	color: var(--c-text-2);
}

.chart-footer {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 0.25rem 1rem;
	margin-top: 0.65rem;
	font-size: 0.78rem;
	color: var(--c-text-3);
}

.chart-source {
	margin-inline-start: auto;
}
</style>
