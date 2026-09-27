<script setup lang="ts">
import type { Map as MaplibreMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/**
 * 地图块的交互地图：只在浏览器里、进入视口时动态加载 maplibre；底图是 OpenFreeMap 的
 * positron / dark（跟着站点的深浅色），读者的 IP 与看的区域会给 tiles.openfreemap.org。
 * 轨迹坐标、地点、停留点都随页面下发（主题服务器取的），浏览器不连轨迹文件的主机。
 * 加载失败（没有 WebGL 等）就报 failed，地图块照旧显示服务端算好的示意图。弹出的卡片只用 textContent 填字
 */
interface Poi { lat: number, lon: number, title?: string, description?: string, address?: string, phone?: string, website?: string }
interface Stop { lat: number, lon: number, duration: number, visits?: number, time?: string }

const props = defineProps<{
	/** [[经度, 纬度], …] 的若干段，JSON 字符串 */
	route?: string
	pois: Poi[]
	/** 停留点，JSON 字符串 */
	stops?: string
	/** `{ center: [经度, 纬度], zoom }`，JSON 字符串 */
	view?: string
}>()

const emit = defineEmits<{
	ready: []
	failed: []
}>()

const LIGHT = 'https://tiles.openfreemap.org/styles/positron'
const DARK = 'https://tiles.openfreemap.org/styles/dark'

const t = useT()
const locale = useUiLocale()
const el = useTemplateRef<HTMLElement>('el')
const colorMode = useColorMode()
const timeZone = useSiteTimeZone()
let map: MaplibreMap | undefined
let started = false

function parse<T>(value: string | undefined, fallback: T): T {
	try {
		return value ? JSON.parse(value) as T : fallback
	}
	catch {
		return fallback
	}
}
const finitePair = (point: unknown): point is [number, number] => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90
const segments = computed(() => parse<unknown[]>(props.route, []).filter(Array.isArray).map(segment => (segment as unknown[]).filter(finitePair)).filter(segment => segment.length > 1) as [number, number][][])
const stopList = computed(() => parse<Stop[]>(props.stops, []).filter(stop => Number.isFinite(stop?.lat) && Number.isFinite(stop?.lon) && Number.isFinite(stop?.duration)))
const view = computed(() => {
	const value = parse<{ center?: unknown, zoom?: unknown }>(props.view, {})
	return finitePair(value.center) && typeof value.zoom === 'number' ? { center: value.center, zoom: value.zoom } : undefined
})

const dark = computed(() => colorMode.value === 'dark')
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim() || '#3a7bd5'

/** 弹出卡片：一行一项，只用 textContent；链接只收 http(s) */
function card(lines: (string | undefined)[], links: { href: string, text: string }[] = []) {
	const box = document.createElement('div')
	box.className = 'map-popup'
	for (const line of lines.filter(Boolean)) {
		const p = document.createElement('p')
		p.textContent = line!
		box.append(p)
	}
	for (const link of links) {
		if (!/^https?:\/\//i.test(link.href))
			continue
		const a = document.createElement('a')
		a.href = link.href
		a.target = '_blank'
		a.rel = 'noopener noreferrer nofollow'
		a.textContent = link.text
		box.append(a)
	}
	return box
}

function osmUrl(lat: number, lon: number) {
	return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`
}

function addRoute() {
	if (!map || !segments.value.length)
		return
	if (map.getSource('route'))
		return
	map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: segments.value } } })
	map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dark.value ? '#000' : '#fff', 'line-opacity': 0.6, 'line-width': 7 } })
	map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': accent(), 'line-width': 3.5 } })
}

async function init() {
	if (!el.value)
		return
	try {
		const [maplibre] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')])
		maplibre.setWorkerUrl(workerUrl)
		const created = new maplibre.Map({
			container: el.value,
			cooperativeGestures: true,
			attributionControl: { compact: true },
			...(view.value ? { center: view.value.center, zoom: view.value.zoom } : {}),
		})
		map = created
		// 样式另外设：载入前修补图层的过滤条件（见 guardMissingProperties）
		created.setStyle(dark.value ? DARK : LIGHT, { transformStyle: guardMissingProperties })
		created.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right')
		created.on('style.load', addRoute)

		// 地点：带编号的标记，点开是小卡片
		props.pois.forEach((poi, index) => {
			const marker = document.createElement('button')
			marker.type = 'button'
			marker.className = 'map-pin'
			marker.textContent = String(index + 1)
			marker.setAttribute('aria-label', poi.title || t('content.place2', { number: index + 1 }))
			new maplibre.Marker({ element: marker })
				.setLngLat([poi.lon, poi.lat])
				.setPopup(new maplibre.Popup({ offset: 14, maxWidth: '16rem' }).setDOMContent(card([poi.title, poi.description, poi.address, poi.phone], [
					...(poi.website ? [{ href: poi.website, text: t('content.website') }] : []),
					{ href: osmUrl(poi.lat, poi.lon), text: t('content.openOpenstreetmap') },
				])))
				.addTo(created)
		})
		// 停留点：小圆点，点开写停留多久、来过几次、开始时间
		for (const stop of stopList.value) {
			const dot = document.createElement('button')
			dot.type = 'button'
			dot.className = 'map-stop'
			dot.setAttribute('aria-label', t('content.stayedMinutes', { n: Math.round(stop.duration / 60) }))
			const time = stop.time ? toZonedLocaleString(stop.time, timeZone.value, 'full', locale.value) : undefined
			new maplibre.Marker({ element: dot })
				.setLngLat([stop.lon, stop.lat])
				.setPopup(new maplibre.Popup({ offset: 8, maxWidth: '14rem' }).setDOMContent(card([`${t('content.stayedMinutes', { n: Math.round(stop.duration / 60) })}${stop.visits && stop.visits > 1 ? ` · ${t('content.visitedTimes', { n: stop.visits })}` : ''}`, time])))
				.addTo(created)
		}

		created.once('load', () => {
			if (!view.value) {
				const points: [number, number][] = [...segments.value.flat(), ...props.pois.map(poi => [poi.lon, poi.lat] as [number, number]), ...stopList.value.map(stop => [stop.lon, stop.lat] as [number, number])]
				if (points.length === 1) {
					created.jumpTo({ center: points[0], zoom: 14 })
				}
				else if (points.length > 1) {
					const bounds = points.reduce((box, point) => box.extend(point), new maplibre.LngLatBounds(points[0], points[0]))
					created.fitBounds(bounds, { padding: 48, maxZoom: segments.value.length ? 16 : 14, duration: 0 })
				}
			}
			emit('ready')
		})
	}
	catch {
		emit('failed')
	}
}

useIntersectionObserver(el, ([entry]) => {
	if (entry?.isIntersecting && !started) {
		started = true
		init()
	}
}, { rootMargin: '200px' })

// 深浅色切换：换底图（轨迹在 style.load 里重新加上）
watch(dark, (value) => {
	map?.setStyle(value ? DARK : LIGHT, { transformStyle: guardMissingProperties })
})

onBeforeUnmount(() => {
	map?.remove()
	map = undefined
})
</script>

<template>
<div ref="el" class="map-canvas" role="region" :aria-label="t('content.interactiveMapCtrl')" />
</template>

<style lang="scss" scoped>
.map-canvas {
	overflow: hidden;
	width: 100%;
	height: 100%;

	:deep(.map-pin) {
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid var(--c-primary);
		border-radius: 50%;
		background-color: var(--c-bg);
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--c-primary);
		cursor: pointer;
	}

	:deep(.map-stop) {
		width: 0.8rem;
		height: 0.8rem;
		border: 2px solid var(--c-bg);
		border-radius: 50%;
		background-color: var(--c-primary);
		cursor: pointer;
	}

	:deep(.maplibregl-popup-content) {
		padding: 0.5em 0.7em;
		border-radius: 0.5em;
		background-color: var(--c-bg);
		font-size: 0.8rem;
		color: var(--c-text);
	}

	:deep(.map-popup) {
		display: grid;
		gap: 0.15em;

		> p {
			margin: 0;
		}

		> p:first-child {
			font-weight: 600;
		}

		> a {
			color: var(--c-primary);
		}
	}
}
</style>
