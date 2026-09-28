<script setup lang="ts">
import type { SearchHit } from '~/types/search'

/**
 * 一条搜索结果。标题与片段按命中词切成文字片段渲染，不用 `v-html`。
 */
const props = defineProps<SearchHit & {
	/** 输入框里的词；core 没给命中词时用它高亮 */
	query?: string
}>()

const t = useT()
const TYPES = computed(() => ({
	post: { icon: 'tabler:file-text', label: t('common.post') },
	note: { icon: 'tabler:notebook', label: t('common.diary') },
	page: { icon: 'tabler:file', label: t('common.page') },
}) as const)

const terms = computed(() => props.keywords.length ? props.keywords : [props.query ?? ''])
const titleParts = computed(() => splitHighlight(props.title, terms.value))
const snippetParts = computed(() => props.snippet ? splitHighlight(props.snippet, terms.value) : [])
</script>

<template>
<UtilLink :to="path" class="search-item">
	<hgroup class="text-creative">
		<span class="title">
			<template v-for="(part, index) in titleParts" :key="index">
				<mark v-if="part.hit">{{ part.text }}</mark>
				<template v-else>{{ part.text }}</template>
			</template>
		</span>
		<Icon :name="TYPES[type].icon" :title="TYPES[type].label" />
	</hgroup>
	<p class="meta">
		{{ TYPES[type].label }}<template v-if="category">
			· {{ category }}
		</template>
	</p>
	<p v-if="snippetParts.length" class="content">
		<template v-for="(part, index) in snippetParts" :key="index">
			<mark v-if="part.hit">{{ part.text }}</mark>
			<template v-else>
				{{ part.text }}
			</template>
		</template>
	</p>
</UtilLink>
</template>

<style scoped>
.search-item {
	display: block;
	margin: 0.5em;
	padding: 0.5em 0.8em;
	border-radius: 0.5em;
	transition: background-color 0.2s;

	&.active {
		background-color: var(--c-bg-soft);
	}
}

.title + .iconify {
	opacity: 0.5;
	margin-inline-start: 0.2em;
}

.meta {
	font-size: 0.75em;
	color: var(--c-text-3);
}

.content {
	margin-top: 0.2em;
	font-size: 0.8em;
	white-space: pre-wrap;
	color: var(--c-text-2);
}
</style>
