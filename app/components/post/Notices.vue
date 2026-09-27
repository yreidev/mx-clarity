<script setup lang="ts">
import type { ContentExtras } from '~/types/article'
import { Temporal } from 'temporal-polyfill'

/**
 * 标题下、正文前的几条提示：站长设的公告、AI 参与声明、过时提醒、core 生成的 AI 摘要。
 * 数据都在服务端净化过（app/utils/mx/extras.ts），这里只按纯文本显示
 */
const props = defineProps<{
	extras?: ContentExtras
	/** 按它算过时天数（文章传 `updated ?? date`；日记不传，不提醒） */
	outdatedFrom?: string
}>()

const t = useT()
const { data: theme } = useMxTheme()
const timeZone = useSiteTimeZone()
// 服务端渲染时的时间随水合数据下发，浏览器用同一个值，天数不会对不上
const now = useRenderNow()

const outdatedDays = computed(() => {
	const limit = theme.value.outdatedDays
	if (!limit || !props.outdatedFrom)
		return 0
	try {
		const from = toZonedTemporal(props.outdatedFrom, timeZone.value).toPlainDate()
		const today = Temporal.Instant.fromEpochMilliseconds(now.value).toZonedDateTimeISO(timeZone.value).toPlainDate()
		const days = from.until(today, { largestUnit: 'day' }).days
		return days > limit ? days : 0
	}
	catch {
		return 0
	}
})

const aiGenText = computed(() => {
	const aiGen = props.extras?.aiGen
	if (!aiGen)
		return ''
	return aiGen.handcrafted ? t('post.handwrittenNoAi') : t('post.aiInvolvement', { labels: aiGen.labels.map(label => t(label)).join(t('post.listSeparator')) })
})
</script>

<template>
<div v-if="extras?.banner || aiGenText || outdatedDays || extras?.aiSummary" class="post-notices">
	<Alert v-if="extras?.banner" :type="extras.banner.type" :title="t('post.announcement')" :text="extras.banner.message" />
	<p v-if="aiGenText" class="post-ai-gen">
		<Icon :name="extras?.aiGen?.handcrafted ? 'tabler:writing' : 'tabler:robot'" />
		{{ aiGenText }}
	</p>
	<Alert v-if="extras?.aiGen?.full" type="info" :title="t('post.aiGenerated')" :text="t('post.postWasGenerated')" />
	<Alert v-if="outdatedDays" type="warning" :title="t('post.mayOutdated')" :text="t('post.postWasLast', { n: outdatedDays })" />
	<details v-if="extras?.aiSummary" class="post-ai-summary gradient-card" open>
		<summary><Icon name="tabler:sparkles" /> {{ t('post.aiSummary') }}</summary>
		<p>{{ extras.aiSummary }}</p>
	</details>
</div>
</template>

<style lang="scss" scoped>
.post-notices {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin: 0.5rem 1.5rem;
}

.post-ai-gen {
	display: flex;
	align-items: center;
	gap: 0.3em;
	font-size: 0.85em;
	color: var(--c-text-2);
}

.post-ai-summary {
	padding: 0.6em 1em;
	border-radius: 0.5em;
	font-size: 0.9em;

	summary {
		display: flex;
		align-items: center;
		gap: 0.3em;
		font-weight: 600;
		cursor: pointer;
	}

	p {
		margin: 0.4em 0 0;
		line-height: 1.7;
	}
}
</style>
