<script setup lang="ts">
import type { NoteProps } from '~/types/note'

/**
 * 日记的附加信息：心情、天气、专栏、回忆标记。
 * 不显示位置：core 只在站长本人请求时返回它，主题取日记时不带站长的会话
 */
defineProps<Pick<NoteProps, 'mood' | 'weather' | 'topic' | 'bookmark'> & {
	/** 放在整张可点的卡片里时专栏名不做成链接：<a> 里不能再套 <a> */
	plainTopic?: boolean
}>()

const t = useT()
</script>

<template>
<div v-if="mood || weather || topic || bookmark" class="note-meta">
	<span v-if="mood"><Icon name="tabler:mood-smile" />{{ mood }}</span>
	<span v-if="weather"><Icon name="tabler:cloud" />{{ weather }}</span>
	<span v-if="topic && plainTopic"><Icon name="tabler:book-2" />{{ topic.name }}</span>
	<UtilLink v-else-if="topic" :to="topic.path" class="note-topic">
		<Icon name="tabler:book-2" />{{ topic.name }}
	</UtilLink>
	<span v-if="bookmark"><Icon name="tabler:bookmark" />{{ t('note.memory') }}</span>
</div>
</template>

<style lang="scss" scoped>
.note-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5em 1.2em;
	font-size: 0.8em;
	color: var(--c-text-2);

	> * {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
	}
}

.note-topic:hover {
	color: var(--c-primary);
}
</style>
