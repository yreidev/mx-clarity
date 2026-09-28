<script setup lang="ts">
import type { NoteProps } from '~/types/note'

defineProps<NoteProps>()
const t = useT()
</script>

<template>
<UtilLink :to="path" class="note-card card upraise">
	<article>
		<h2 class="note-title text-story">
			{{ title }}
		</h2>
		<p v-if="excerpt" class="note-excerpt">
			{{ excerpt }}
		</p>
		<div class="note-info">
			<UtilDate :date icon="tabler:calendar" />
			<NoteMeta :mood :weather :topic :bookmark plain-topic />
			<!-- 前缀版的列表里，这一篇拿到的是 AI 译文 -->
			<span v-if="translated" class="note-translated">
				<Icon name="tabler:language" />
				{{ t('post.aiTranslation') }}
			</span>
		</div>
	</article>
</UtilLink>
</template>

<style scoped>
.note-card {
	margin: 1em 0;
	border-radius: 0.8em;
	color: var(--c-text);

	> article {
		display: grid;
		gap: 0.5em;
		padding: 1em;
	}
}

.note-title {
	font-size: 1.2em;
}

.note-excerpt {
	font-size: 0.9em;
	color: var(--c-text-2);
}

.note-info {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5em 1.2em;
	font-size: 0.8em;
	color: var(--c-text-2);
}

.note-translated {
	color: var(--c-primary);
}
</style>
