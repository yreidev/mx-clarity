<script setup lang="ts">
import type { NoteLink } from '~/types/note'

/** 日记的前后篇（mx 自带）；样式跟随文章的 PostSurround */
defineProps<{
	newer?: NoteLink
	older?: NoteLink
}>()

const t = useT()
</script>

<template>
<nav v-if="newer || older" class="note-surround" :aria-label="t('note.adjacentDiaryEntries')">
	<UtilLink v-if="newer" :to="newer.path" class="surround-link">
		<Icon name="tabler:chevron-left" />
		<span class="surround-text">
			<strong class="text-story">{{ newer.title || t('note.entry', { number: newer.nid }) }}</strong>
			<UtilDate v-if="newer.date" class="date" :date="newer.date" />
		</span>
	</UtilLink>
	<span v-else />
	<UtilLink v-if="older" :to="older.path" class="surround-link align-end">
		<span class="surround-text">
			<strong class="text-story">{{ older.title || t('note.entry', { number: older.nid }) }}</strong>
			<UtilDate v-if="older.date" class="date" :date="older.date" />
		</span>
		<Icon name="tabler:chevron-right" />
	</UtilLink>
</nav>
</template>

<style scoped>
.note-surround {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 1rem;
	margin: 3rem 1rem;
}

.surround-link {
	display: flex;
	align-items: center;
	gap: 0.5em;
	max-width: 100%;
	padding: 0.5em 0.8em;
	border-radius: 0.5em;
	transition: background-color 0.2s;

	&:hover {
		background-color: var(--c-bg-soft);
	}

	&.align-end {
		margin-inline-start: auto;
		text-align: end;
	}
}

.surround-text {
	display: grid;

	.date {
		font-size: 0.8em;
		color: var(--c-text-2);
	}
}
</style>
