<script setup lang="ts">
const t = useT()
const { data: site } = await useMxSite()
useSeoMeta({ title: () => t('note.series'), description: () => t('note.diarySeries', { site: site.value.title }) })

const { data: topics, error, refresh } = await useMxTopics()
</script>

<template>
<BlogHeader class="hide-above-mobile" to="/notes" :suffix="t('note.series')" tag="h1" />

<div class="topic-list proper-height">
	<ZError v-if="error" icon="tabler:cloud-off" :title="t('note.seriesUnavailableRight')">
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>
	<p v-else-if="!topics.length" class="empty">
		{{ t('note.noSeriesYet') }}
	</p>
	<UtilLink v-for="topic in topics" v-else :key="topic.slug" :to="topic.path" class="topic-card card upraise">
		<img v-if="topic.icon" :src="topic.icon" :alt="topic.name" class="topic-icon">
		<Icon v-else name="tabler:book-2" class="topic-icon" />
		<div>
			<h2 class="text-story">
				{{ topic.name }}
			</h2>
			<p v-if="topic.description">
				{{ topic.description }}
			</p>
		</div>
	</UtilLink>
</div>
</template>

<style scoped>
.topic-list {
	display: grid;
	gap: 1em;
	margin: 1rem;
}

.topic-card {
	display: flex;
	align-items: center;
	gap: 1em;
	padding: 1em;
	border-radius: 0.8em;
	color: var(--c-text);

	h2 {
		font-size: 1.2em;
	}

	p {
		font-size: 0.9em;
		color: var(--c-text-2);
	}
}

.topic-icon {
	flex-shrink: 0;
	width: 2.5em;
	height: 2.5em;
	border-radius: 0.5em;
	color: var(--c-text-2);
	object-fit: cover;
}

.empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}
</style>
