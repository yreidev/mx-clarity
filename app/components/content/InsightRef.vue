<script setup lang="ts">
/**
 * AI 洞察里的「跳回原文」：在页面的正文里找这段引用，找到就滚过去闪一下；找不到就变成不可点的提示
 */
const props = defineProps<{
	quote: string
	section?: string
}>()

const missing = ref(false)
const t = useT()

function jump() {
	const body = document.querySelector('#main-content article.article')
	const range = body && locateQuote(body, props.quote)
	if (!range) {
		missing.value = true
		return
	}
	flashRange(range)
}
</script>

<template>
<span v-if="missing" class="insight-ref missing" :title="t('content.notFoundText', { quote })">{{ t('content.excerpt') }}</span>
<button v-else type="button" class="insight-ref" :title="quote" :aria-label="section ? t('content.jumpPassage', { section, quote }) : t('content.jumpToThePassage', { quote })" @click="jump">
	<Icon name="tabler:corner-down-left" />
</button>
</template>

<style scoped>
.insight-ref {
	display: inline-flex;
	align-items: center;
	margin: 0 0.15em;
	padding: 0 0.2em;
	border-radius: 0.3em;
	font-size: 0.8em;
	vertical-align: 0.05em;
	color: var(--c-primary);

	&:hover {
		background-color: var(--c-primary-soft);
	}

	&.missing {
		color: var(--c-text-3);
	}
}
</style>
