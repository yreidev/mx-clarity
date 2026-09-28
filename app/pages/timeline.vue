<script setup lang="ts">
import type { TimelineEntry } from '~/types/timeline'
import { groupBy } from 'es-toolkit/array'
import { Temporal } from 'temporal-polyfill'

/**
 * 时间线：文章与日记按时间混排，按「年 → 月」分组（站点时区）。三种视图：
 * 舒（默认，归档页的条目，日记带心情与天气）、密（一行一条）、概览（每月一根条，点一下回到舒并滚到那个月）。
 * 视图写在 `?view=` 里（舒不写），也记在本机；`?selectId=<id>` 滚到那一条并闪一下。条目能弹站内预览
 */
const t = useT()
const { data: site } = useMxSite()
useSeoMeta({
	title: t('common.timeline'),
	description: () => t('timeline.postsDiaryEntries', { site: site.value.title }),
})

const { data: all, error } = await useMxTimeline()

// 筛选：?type=post|note 只看文章或日记，?memory=1 只看站长标成「回忆」的日记；数据仍是那一份缓存
type Filter = 'all' | 'post' | 'note' | 'memory'
type View = 'relaxed' | 'dense' | 'skim'
const route = useRoute()
const router = useRouter()
const filter = computed<Filter>(() => route.query.memory === '1' ? 'memory' : route.query.type === 'post' || route.query.type === 'note' ? route.query.type : 'all')
const FILTERS = computed((): { value: Filter, label: string, query: Record<string, string> }[] => [
	{ value: 'all', label: t('timeline.all'), query: {} },
	{ value: 'post', label: t('timeline.posts2'), query: { type: 'post' } },
	{ value: 'note', label: t('common.diary'), query: { type: 'note' } },
	{ value: 'memory', label: t('timeline.memories'), query: { memory: '1' } },
])
const VIEWS = computed<{ value: View, label: string }[]>(() => [
	{ value: 'relaxed', label: t('timeline.relaxed') },
	{ value: 'dense', label: t('timeline.compact') },
	{ value: 'skim', label: t('timeline.overview') },
])
const view = computed<View>(() => route.query.view === 'dense' || route.query.view === 'skim' ? route.query.view : 'relaxed')
const savedView = useLocalStorage<View>('mx-clarity:timeline-view', 'relaxed')
const localePath = useLocalePath()
/** 筛选链接保留当前视图 */
function filterTo(query: Record<string, string>) {
	const params = new URLSearchParams({ ...query, ...(view.value === 'relaxed' ? {} : { view: view.value }) })
	return localePath(`/timeline${params.size ? `?${params}` : ''}`)
}
function setView(next: View) {
	savedView.value = next
	const query = { ...route.query }
	if (next === 'relaxed')
		delete query.view
	else
		query.view = next
	delete query.selectId
	router.replace({ query })
}

const entries = computed(() => all.value.filter(entry => filter.value === 'all'
	|| (filter.value === 'memory' ? entry.type === 'note' && entry.bookmark : entry.type === filter.value)))
const hasMemory = computed(() => all.value.some(entry => entry.bookmark))

const timeZone = useSiteTimeZone()
/** 按站点时区分年、月：同一时刻在不同时区可能跨年跨月 */
function zoned(date: string) {
	try {
		const value = toZonedTemporal(date, timeZone.value)
		return { year: String(value.year), month: String(value.month).padStart(2, '0'), day: String(value.day).padStart(2, '0') }
	}
	catch {
		return { year: '', month: '', day: '' }
	}
}
const years = computed(() => Object.entries(groupBy(entries.value, entry => zoned(entry.date).year))
	.sort(([a], [b]) => Number(b) - Number(a))
	.map(([year, list]) => ({
		year,
		list,
		months: Object.entries(groupBy(list, entry => zoned(entry.date).month))
			.sort(([a], [b]) => Number(b) - Number(a))
			.map(([month, items]) => ({ month, key: `${year}-${month}`, items })),
	})))

const countOf = (list: TimelineEntry[], type: TimelineEntry['type']) => list.filter(entry => entry.type === type).length

/** 概览：一年 12 个月，条的长度 = 当月篇数 / 当年最多那个月（有内容的最短 6%） */
function skimRows(year: { year: string, list: TimelineEntry[] }) {
	const counts = Array.from({ length: 12 }, (_, i) => year.list.filter(entry => Number(zoned(entry.date).month) === i + 1).length)
	const max = Math.max(1, ...counts)
	return counts.map((count, i) => ({ month: String(i + 1).padStart(2, '0'), count, width: count ? Math.max(6, count / max * 100) : 0 })).reverse()
}

async function jumpToMonth(key: string) {
	setView('relaxed')
	await nextTick()
	document.getElementById(`m-${key}`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

/** 复用归档页的条目组件：日记没有分类，换成日记的图标；心情、天气放在标签的位置 */
function archiveProps(entry: TimelineEntry) {
	return {
		title: entry.title,
		path: entry.path,
		date: entry.date,
		categories: entry.category ? [entry.category] : undefined,
		tags: entry.type === 'note' ? [entry.mood, entry.weather].filter((item): item is string => Boolean(item)) : entry.tags,
		icon: entry.type === 'note' ? 'tabler:notebook' : undefined,
	}
}

// 今年第几天、过了百分之几（站点时区；只在浏览器里算，免得跨零点时和服务端的不一致）
const progress = ref('')
onMounted(() => {
	const today = Temporal.Now.plainDateISO(timeZone.value)
	progress.value = t('timeline.dayYearElapsed', { day: today.dayOfYear, percent: (today.dayOfYear / today.daysInYear * 100).toFixed(1) })
	// 回到上次选的视图（地址里没写视图时）
	if (!route.query.view && savedView.value !== 'relaxed' && VIEWS.value.some(item => item.value === savedView.value))
		setView(savedView.value)
	const selected = typeof route.query.selectId === 'string' ? route.query.selectId : ''
	if (/^\d{1,20}$/.test(selected)) {
		nextTick(() => {
			const el = document.getElementById(`tl-${selected}`)
			el?.scrollIntoView({ block: 'center' })
			el?.classList.add('timeline-flash')
		})
	}
})
</script>

<template>
<template #aside>
	<WidgetBlogStats />
</template>

<div class="timeline proper-height">
	<div class="hide-above-mobile">
		<BlogHeader to="/" :suffix="t('common.timeline')" tag="h1" />
	</div>

	<div v-if="all.length" class="timeline-bar">
		<nav class="timeline-filter" :aria-label="t('timeline.filter')">
			<template v-for="item in FILTERS" :key="item.value">
				<NuxtLink
					v-if="item.value !== 'memory' || hasMemory"
					:to="filterTo(item.query)"
					:aria-current="filter === item.value ? 'page' : undefined"
				>
					{{ item.label }}
				</NuxtLink>
			</template>
		</nav>
		<div class="timeline-views" role="group" :aria-label="t('timeline.view')">
			<button v-for="item in VIEWS" :key="item.value" type="button" :aria-pressed="view === item.value" @click="setView(item.value)">
				{{ item.label }}
			</button>
		</div>
	</div>
	<p v-if="progress" class="timeline-progress">
		{{ progress }}
	</p>

	<p v-if="error" class="timeline-empty">
		{{ t('timeline.timelineCantLoaded') }}
	</p>
	<p v-else-if="!entries.length" class="timeline-empty">
		{{ all.length ? t('timeline.nothingMatches') : t('timeline.nothingHereYet') }}
	</p>

	<div data-peek>
		<section v-for="year in years" :key="year.year" class="timeline-group">
			<div class="timeline-title">
				<h2 class="timeline-year">
					{{ year.year }}
				</h2>
				<div class="timeline-info">
					<span v-if="countOf(year.list, 'post')">{{ t('timeline.posts', { n: countOf(year.list, 'post') }) }}</span>
					<span v-if="countOf(year.list, 'note')">{{ t('timeline.diaryEntries', { n: countOf(year.list, 'note') }) }}</span>
				</div>
			</div>

			<ol v-if="view === 'skim'" class="timeline-skim">
				<li v-for="row in skimRows(year)" :key="row.month">
					<button type="button" :disabled="!row.count" :aria-label="t('timeline.monthEntries', { month: Number(row.month), n: row.count })" @click="jumpToMonth(`${year.year}-${row.month}`)">
						<span class="timeline-skim-month">{{ t('timeline.monthLabel', { month: Number(row.month) }) }}</span>
						<span class="timeline-skim-track"><span :style="{ width: `${row.width}%` }" /></span>
						<span class="timeline-skim-count">{{ row.count || '' }}</span>
					</button>
				</li>
			</ol>

			<template v-else>
				<div v-for="month in year.months" :id="`m-${month.key}`" :key="month.key" class="timeline-month">
					<h3>{{ t('timeline.monthLabel', { month: Number(month.month) }) }}</h3>
					<ul v-if="view === 'dense'" class="timeline-dense">
						<li v-for="entry in month.items" :id="`tl-${entry.id}`" :key="entry.path">
							<time :datetime="entry.date">{{ month.month }}-{{ zoned(entry.date).day }}</time>
							<UtilLink :to="entry.path">
								{{ entry.title }}
							</UtilLink>
							<span class="timeline-dense-type">{{ entry.type === 'note' ? t('common.diary') : t('common.post') }}</span>
						</li>
					</ul>
					<menu v-else class="timeline-list">
						<PostArchive
							v-for="entry in month.items"
							:id="`tl-${entry.id}`"
							:key="entry.path"
							v-bind="archiveProps(entry)"
							:to="entry.path"
							show-category
						/>
					</menu>
				</div>
			</template>
		</section>
	</div>
</div>
</template>

<style scoped>
.timeline {
	padding: 1rem;
}

.timeline-bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 0.5em 1em;
	margin: 0.5rem 0 0.3rem;
	font-size: 0.9em;
}

.timeline-filter, .timeline-views {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3em;

	> a, > button {
		padding: 0.2em 0.8em;
		border-radius: 1em;
		color: var(--c-text-2);
		transition: color 0.1s, background-color 0.2s;

		&:hover {
			color: var(--c-primary);
		}

		&[aria-current="page"], &[aria-pressed="true"] {
			background-color: var(--c-primary-soft);
			color: var(--c-primary);
		}
	}
}

.timeline-progress {
	margin: 0 0 1.5rem;
	font-size: 0.8em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
}

.timeline-empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}

.timeline-group {
	margin: 1rem 0 3rem;
}

.timeline-title {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 1em;
	margin-bottom: 0.5em;
	color: var(--c-text-3);

	> .timeline-year {
		font-family: var(--font-stroke-free);
		font-size: 2.5em;
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		line-height: 1;
		color: transparent;
		-webkit-text-stroke: 1px var(--c-text-3);
	}
}

.timeline-info {
	display: flex;
	gap: 1em;
	font-size: 0.85em;
}

.timeline-month {
	scroll-margin-top: 4rem;

	> h3 {
		margin: 1em 0 0.3em;
		font-size: 0.85em;
		font-weight: 600;
		color: var(--c-text-3);
	}
}

.timeline-dense {
	display: grid;
	gap: 0.15em;
	margin: 0;
	padding: 0;
	font-size: 0.9em;
	list-style: none;

	> li {
		display: flex;
		align-items: baseline;
		gap: 0.6em;
		min-width: 0;
		border-radius: 0.3em;
	}

	time {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
		color: var(--c-text-3);
	}

	a {
		overflow: hidden;
		min-width: 0;
		white-space: nowrap;
		text-overflow: ellipsis;

		&:hover {
			color: var(--c-primary);
		}
	}
}

.timeline-dense-type {
	flex-shrink: 0;
	margin-inline-start: auto;
	font-size: 0.85em;
	color: var(--c-text-3);
}

.timeline-skim {
	display: grid;
	gap: 0.2em;
	margin: 0;
	padding: 0;
	list-style: none;

	button {
		display: grid;
		grid-template-columns: 3em 1fr 2em;
		align-items: center;
		gap: 0.6em;
		width: 100%;
		padding: 0.15em 0.3em;
		border-radius: 0.3em;
		font-size: 0.85em;
		font-variant-numeric: tabular-nums;
		color: var(--c-text-2);

		&:hover:not(:disabled) {
			background-color: var(--c-bg-2);
			color: var(--c-primary);
		}

		&:disabled {
			color: var(--c-text-3);
		}
	}
}

.timeline-skim-track {
	height: 0.5em;

	> span {
		display: block;
		opacity: 0.7;
		height: 100%;
		border-radius: 0.25em;
		background-color: var(--c-primary);
	}
}

.timeline-skim-count {
	text-align: end;
}

:deep(.timeline-flash) {
	animation: timeline-flash 2.4s ease;
}

@keyframes timeline-flash {
	0%, 60% { background-color: var(--c-primary-soft); }
	100% { background-color: transparent; }
}
</style>
