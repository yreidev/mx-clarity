<script setup lang="ts">
import type { SayProps } from '~/types/note'

/** 随机一条说说，能换一条。只在浏览器里取（每次都不一样，不做服务端渲染） */
const t = useT()
const say = ref<SayProps | null>()
const loading = ref(false)

async function next() {
	if (loading.value)
		return
	loading.value = true
	say.value = await $fetch<SayProps | null>('/api/mx/says/random', { query: { except: say.value?.id } }).catch(() => say.value ?? null)
	loading.value = false
}
onMounted(next)
</script>

<template>
<BlogWidget v-if="say" card :title="t('says.randomQuote')">
	<template #action>
		<button type="button" class="say-next" :disabled="loading" :aria-label="t('says.showAnother')" @click="next">
			<Icon name="tabler:refresh" />
		</button>
	</template>
	<blockquote class="say-text" aria-live="polite">
		{{ say.text }}
		<footer v-if="say.author || say.source">
			— {{ [say.author, say.source && t('common.quotedTitle', { source: say.source })].filter(Boolean).join(' ') }}
		</footer>
	</blockquote>
</BlogWidget>
</template>

<style lang="scss" scoped>
.say-next {
	display: inline-flex;
	color: var(--c-text-3);

	&:hover:not(:disabled) {
		color: var(--c-primary);
	}
}

.say-text {
	overflow-wrap: anywhere;
	margin: 0;
	font-size: 0.9em;
	line-height: 1.7;

	footer {
		margin-top: 0.3em;
		font-size: 0.85em;
		color: var(--c-text-3);
	}
}
</style>
