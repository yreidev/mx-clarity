<script setup lang="ts">
const route = useRoute()
const t = useT()
const locale = useUiLocale()
const slug = computed(() => String(route.params.slug))
const page = useRouteQuery('page', '1', { transform: Number })

const { data, error, refresh } = await useMxTopic(slug, page)
const notFound = computed(() => !data.value && (!error.value || error.value.statusCode === 404))

// 最近更新：第一页里最新一篇的时间（专栏的日记新的在前，第一页就有最新的）
const timeZone = useSiteTimeZone()
const lastUpdated = computed(() => page.value === 1
	? data.value?.notes.items.map(note => note.date).filter(date => Number.isFinite(Date.parse(date))).toSorted((a, b) => Date.parse(b) - Date.parse(a))[0]
	: undefined)

if (data.value) {
	useSeoMeta({ title: () => data.value?.topic.name, description: () => data.value?.topic.description })
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, notFound.value ? 404 : (error.value?.statusCode ?? 500))
	route.meta.title = notFound.value ? '404' : t('common.temporarilyUnavailable')
}
</script>

<template>
<BlogHeader class="hide-above-mobile" to="/notes/series" :suffix="data?.topic.name ?? t('note.series')" tag="h1" />

<div v-if="data" class="topic-detail proper-height">
	<header class="topic-header">
		<h1 class="text-story">
			{{ data.topic.name }}
		</h1>
		<MxRenderer v-if="data.descriptionBody" class="topic-description article" :body="data.descriptionBody" />
		<p v-if="data.topic.introduce" class="topic-introduce">
			{{ data.topic.introduce }}
		</p>
		<p v-if="lastUpdated" class="topic-updated">
			<Icon name="tabler:clock" />
			{{ t('note.lastUpdated') }} <time :datetime="lastUpdated">{{ toZonedLocaleString(lastUpdated, timeZone, 'date', locale) }}</time>
		</p>
	</header>
	<p v-if="!data.notes.items.length" class="empty">
		{{ t('note.noDiaryEntriesSeries') }}
	</p>
	<NoteCard v-for="note in data.notes.items" :key="note.nid" v-bind="note" />
	<ZPagination v-if="data.notes.totalPages > 1" v-model="page" :total-pages="data.notes.totalPages" />
</div>

<ZError v-else-if="notFound" icon="line-md:document-delete-twotone" :title="t('note.seriesNotFound')" />

<ZError v-else icon="tabler:cloud-off" :title="t('note.seriesUnavailableRight')">
	<template #operation>
		<ZButton :text="t('common.retry')" @click="refresh()" />
	</template>
</ZError>
</template>

<style scoped>
.topic-detail {
	margin: 1rem;
}

.topic-header {
	display: grid;
	gap: 0.5em;
	margin-bottom: 1.5em;

	h1 {
		font-size: 1.6em;
	}

	p {
		color: var(--c-text-2);
	}
}

.topic-introduce {
	font-size: 0.9em;
}

.topic-updated {
	display: flex;
	align-items: center;
	gap: 0.3em;
	font-size: 0.85em;
}

.empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}
</style>
