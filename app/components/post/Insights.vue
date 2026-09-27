<script setup lang="ts">
import type { InsightsResult } from '~/types/insights'

/**
 * AI 精读（core 已经生成好的洞察）：点开才取；内容里的「跳回原文」在正文里定位。
 * 只读库里已有的，不会让 core 当场生成（服务端只用 onlyDb）
 */
const props = defineProps<{
	id: string
}>()

const t = useT()
const open = ref(false)
const result = ref<InsightsResult>()
const failed = ref(false)
const DIFFICULTY = computed(() => ({ easy: t('post.beginner'), medium: t('post.intermediate'), hard: t('post.advanced') }))

async function toggle() {
	open.value = !open.value
	if (!open.value || result.value)
		return
	failed.value = false
	result.value = await $fetch<InsightsResult>(`/api/mx/insights/${props.id}`).catch(() => {
		failed.value = true
		return undefined
	})
}
</script>

<template>
<section class="post-insights" aria-labelledby="post-insights-title">
	<button id="post-insights-title" type="button" class="post-insights-toggle" :aria-expanded="open" @click="toggle">
		<Icon name="tabler:sparkles" /> {{ t('post.aiInsights') }}
		<Icon :name="open ? 'tabler:chevron-up' : 'tabler:chevron-down'" />
	</button>
	<div v-if="open" class="post-insights-body">
		<p v-if="failed" class="post-insights-note">
			{{ t('common.couldntLoadRight') }}
		</p>
		<p v-else-if="!result" class="post-insights-note" role="status">
			{{ t('common.loading') }}
		</p>
		<p v-else-if="result.status === 'locked'" class="post-insights-note">
			{{ t('post.theseInsightsBelong') }}
		</p>
		<p v-else-if="result.status === 'none'" class="post-insights-note">
			{{ t('post.insightsPostArent') }}
		</p>
		<template v-else>
			<p class="post-insights-meta">
				{{ t('post.aiGeneratedReference') }}{{ result.meta.readingMinutes ? ` · ${t('post.aboutMinRead', { n: result.meta.readingMinutes })}` : '' }}{{ result.meta.difficulty ? ` · ${t('post.difficulty', { level: DIFFICULTY[result.meta.difficulty] })}` : '' }}
			</p>
			<MxRenderer :body="result.body" class="article post-insights-content" />
		</template>
	</div>
</section>
</template>

<style lang="scss" scoped>
.post-insights {
	margin: 2rem 1.5rem 0;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
}

.post-insights-toggle {
	display: flex;
	align-items: center;
	gap: 0.3em;
	width: 100%;
	padding: 0.7em 1em;
	font-weight: 600;
	text-align: start;

	> :last-child {
		margin-inline-start: auto;
	}
}

.post-insights-body {
	padding: 0 1em 1em;
}

.post-insights-note, .post-insights-meta {
	font-size: 0.85em;
	color: var(--c-text-2);
}
</style>
