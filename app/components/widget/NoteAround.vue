<script setup lang="ts">
import type { NoteNeighbors } from '~/types/note'

/**
 * 日记详情侧栏：这篇前后各几篇日记（只有游客可见的），当前这篇夹在中间。
 * 数据由服务端从缓存的时间线里取，换日记时跟着换
 */
const route = useRoute()
const nid = computed(() => {
	const path = route.params.path
	const first = Array.isArray(path) ? path[0] : path
	return Array.isArray(path) && path.length === 1 && /^\d{1,9}$/.test(first ?? '') ? Number(first) : 0
})
const { data } = useLazyFetch<NoteNeighbors>(() => `/api/mx/notes/${nid.value}/around`, {
	key: computed(() => `mx-note-around-${nid.value}`),
	server: false,
	immediate: nid.value > 0,
})
const timeZone = useSiteTimeZone()
const t = useT()
const locale = useUiLocale()
const dateOf = (date: string) => toZonedLocaleString(date, timeZone.value, 'date', locale.value)
</script>

<template>
<BlogWidget v-if="data && (data.newer.length || data.older.length)" card :title="t('site.nearbyDiaryEntries')">
	<ol class="note-around">
		<li v-for="item in [...data.newer].reverse()" :key="item.path">
			<UtilLink :to="item.path">
				{{ item.title }}
			</UtilLink>
			<time :datetime="item.date">{{ dateOf(item.date) }}</time>
		</li>
		<li class="current" aria-current="page">
			<span>{{ t('site.thisEntry') }}</span>
		</li>
		<li v-for="item in data.older" :key="item.path">
			<UtilLink :to="item.path">
				{{ item.title }}
			</UtilLink>
			<time :datetime="item.date">{{ dateOf(item.date) }}</time>
		</li>
	</ol>
</BlogWidget>
</template>

<style lang="scss" scoped>
.note-around {
	display: grid;
	gap: 0.3em;
	margin: 0;
	padding: 0;
	font-size: 0.9em;
	list-style: none;

	li {
		display: flex;
		align-items: baseline;
		gap: 0.5em;
		min-width: 0;
	}

	a {
		flex-grow: 1;
		overflow: hidden;
		min-width: 0;
		white-space: nowrap;
		text-overflow: ellipsis;

		&:hover {
			color: var(--c-primary);
		}
	}

	time {
		flex-shrink: 0;
		font-size: 0.85em;
		font-variant-numeric: tabular-nums;
		color: var(--c-text-3);
	}

	.current {
		font-weight: 600;
		color: var(--c-primary);
	}
}
</style>
