<script setup lang="ts">
/**
 * 正文里的地图块（Lexical 的 map）：进入视口后换成交互地图（`UtilMapCanvas`，maplibre + OpenFreeMap 瓦片）；
 * 加载前与加载失败时是服务端算好的静态示意图。下面列出距离、时长与地点清单，每个地点有 OpenStreetMap 的外链
 */
const props = defineProps<{
	title?: string
	/** 服务端整理过的地点（JSON 字符串） */
	pois?: string
	chartWidth?: number
	chartHeight?: number
	/** 轨迹路径数组的 JSON 字符串 */
	tracks?: string
	markerX?: number[]
	markerY?: number[]
	distance?: string
	duration?: string
	trackMissing?: boolean
	/** 交互地图用的轨迹坐标、停留点、固定视角（JSON 字符串） */
	route?: string
	stops?: string
	view?: string
}>()

const t = useT()
const interactive = ref(false)
const failed = ref(false)

interface Poi { lat: number, lon: number, title?: string, description?: string, address?: string, phone?: string, website?: string }

const places = computed<Poi[]>(() => {
	try {
		const parsed = JSON.parse(props.pois ?? '[]')
		return Array.isArray(parsed)
			? parsed.filter((poi): poi is Poi => typeof poi?.lat === 'number' && typeof poi?.lon === 'number' && Number.isFinite(poi.lat) && Number.isFinite(poi.lon)).slice(0, 50)
			: []
	}
	catch {
		return []
	}
})

const osmUrl = (poi: Poi) => `https://www.openstreetmap.org/?mlat=${poi.lat.toFixed(6)}&mlon=${poi.lon.toFixed(6)}#map=16/${poi.lat.toFixed(6)}/${poi.lon.toFixed(6)}`
const safeWebsite = (url?: string) => url && /^https?:\/\//i.test(url) ? url : undefined
const trackPaths = computed<string[]>(() => {
	try {
		const parsed = JSON.parse(props.tracks ?? '[]')
		return Array.isArray(parsed) ? parsed.filter(path => typeof path === 'string' && /^[\d\s.ML-]*$/.test(path)) : []
	}
	catch {
		return []
	}
})
const markers = computed(() => (props.markerX ?? []).map((x, i) => ({ x, y: props.markerY?.[i] ?? 0 })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
const hasChart = computed(() => Boolean(props.chartWidth && props.chartHeight && (trackPaths.value.length || markers.value.length)))
</script>

<template>
<figure class="map-block card">
	<figcaption class="map-head">
		<Icon name="tabler:map-2" />
		<span>{{ title || t('content.map') }}</span>
		<span v-if="distance || duration" class="map-stats">{{ [distance, duration].filter(Boolean).join(' · ') }}</span>
	</figcaption>
	<!-- 交互地图与示意图占同一个框：地图在框里隐形地加载（视口观察器要它在布局里），就绪后盖住示意图，不跳版 -->
	<div v-show="hasChart || !failed" class="map-stage" :style="{ aspectRatio: `${chartWidth || 5} / ${chartHeight || 3}` }">
		<svg
			v-if="hasChart"
			v-show="!interactive"
			class="map-chart"
			:viewBox="`0 0 ${chartWidth} ${chartHeight}`"
			role="img"
			:aria-label="places.length ? t('content.staticMapPlaces', { title: title || t('content.map'), n: places.length }) : t('content.staticMap', { title: title || t('content.map') })"
		>
			<path v-for="(track, index) in trackPaths" :key="`t${index}`" class="map-track" :d="track" />
			<g v-for="(marker, index) in markers" :key="`m${index}`" class="map-marker">
				<circle :cx="marker.x" :cy="marker.y" r="7" />
				<text :x="marker.x" :y="marker.y" dy="0.35em">{{ index + 1 }}</text>
			</g>
		</svg>
		<ClientOnly>
			<UtilMapCanvas
				class="map-live"
				:class="{ ready: interactive }"
				:route
				:pois="places"
				:stops
				:view
				@ready="interactive = true"
				@failed="failed = true"
			/>
		</ClientOnly>
	</div>
	<p v-if="trackMissing" class="map-note">
		{{ t('content.trackCantShown') }}
	</p>
	<ol v-if="places.length" class="map-places">
		<li v-for="(poi, index) in places" :key="index">
			<a :href="osmUrl(poi)" target="_blank" rel="noopener noreferrer nofollow" :title="poi.title ? t('content.viewOnOpenstreetmap', { place: poi.title }) : t('content.viewOpenstreetmap')">
				{{ poi.title || t('content.place', { index: index + 1 }) }}
			</a>
			<span v-if="poi.address" class="map-detail">{{ poi.address }}</span>
			<span v-if="poi.description" class="map-detail">{{ poi.description }}</span>
			<span v-if="poi.phone" class="map-detail">{{ poi.phone }}</span>
			<a v-if="safeWebsite(poi.website)" class="map-detail" :href="safeWebsite(poi.website)" target="_blank" rel="noopener noreferrer nofollow">{{ t('content.website') }}</a>
		</li>
	</ol>
</figure>
</template>

<style lang="scss" scoped>
.map-block {
	margin: 1.5em 0;
	padding: 0.9em 1.1em;
	font-size: 0.9em;
}

.map-head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3em 0.6em;
	font-weight: 600;
}

.map-stats, .map-note {
	font-size: 0.85em;
	font-weight: normal;
	color: var(--c-text-2);
}

.map-stage {
	position: relative;
	overflow: hidden;
	width: 100%;
	max-height: 70vh;
	margin-top: 0.6em;
	border-radius: 0.5em;
	background-color: var(--c-bg-2);

	// 手机上按示意图的宽高比只有 200px 上下高：拖不开，底图的署名（小地图上先展开，拖动后才收起）还要占掉三分之一
	@media (max-width: $breakpoint-phone) {
		min-height: 18rem;
	}
}

.map-chart {
	display: block;
	width: 100%;
	height: 100%;
}

.map-live {
	position: absolute;
	visibility: hidden;
	inset: 0;

	&.ready {
		visibility: visible;
	}
}

.map-track {
	fill: none;
	stroke: var(--c-primary);
	stroke-width: 2.5;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.map-marker {
	circle {
		fill: var(--c-bg);
		stroke: var(--c-primary);
		stroke-width: 2;
	}

	text {
		font-size: 9px;
		font-weight: 700;
		text-anchor: middle;
		fill: var(--c-primary);
	}
}

.map-places {
	display: grid;
	gap: 0.3em;
	margin: 0.6em 0 0;
	padding-inline-start: 1.5em;

	li {
		overflow-wrap: anywhere;
	}

	a {
		color: var(--c-primary);
	}
}

.map-detail {
	margin-inline-start: 0.6em;
	font-size: 0.85em;
	color: var(--c-text-3);
}
</style>
