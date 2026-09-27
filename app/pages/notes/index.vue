<script setup lang="ts">
const t = useT()
const page = useRouteQuery('page', '1', { transform: Number })
const { data: site } = await useMxSite()
useSeoMeta({
	title: () => (page.value > 1 ? t('note.diaryPage', { page: page.value }) : t('common.diary')),
	description: () => t('note.theDiaryOf', { site: site.value.title }),
})

const { data, error, refresh } = await useMxNotes(page)
</script>

<template>
<BlogHeader class="mobile-only" to="/" :suffix="t('common.diary')" tag="h1" />

<div class="note-list proper-height">
	<div class="note-list-nav">
		<UtilLink to="/notes/series">
			<Icon name="tabler:book-2" /> {{ t('note.series') }}
		</UtilLink>
	</div>

	<ZError v-if="error" icon="tabler:cloud-off" :title="t('note.couldntLoadDiary')">
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>
	<p v-else-if="!data?.items.length" class="empty">
		{{ t('note.noDiaryEntries') }}
	</p>
	<template v-else>
		<NoteCard v-for="note in data.items" :key="note.nid" v-bind="note" />
		<ZPagination v-if="data.totalPages > 1" v-model="page" :total-pages="data.totalPages" />
	</template>
</div>
</template>

<style lang="scss" scoped>
.note-list {
	margin: 1rem;
}

.note-list-nav {
	display: flex;
	justify-content: flex-end;
	font-size: 0.9em;
	color: var(--c-text-2);

	a:hover {
		color: var(--c-primary);
	}
}

.empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}
</style>
