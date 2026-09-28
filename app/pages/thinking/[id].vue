<script setup lang="ts">
const route = useRoute()
const t = useT()
const id = computed(() => String(route.params.id))

const { data: item, error, refresh } = await useMxThinkingItem(id)
const notFound = computed(() => !item.value && (!error.value || error.value.statusCode === 404))

if (item.value) {
	const ogImage = useDefaultOgImage()
	// 标题带上正文开头，搜索结果与分享卡片里看得出是哪一条
	useSeoMeta({
		title: () => (item.value?.excerpt ? t('thinking.thinking', { excerpt: item.value.excerpt.slice(0, 30) }) : t('common.thinking')),
		description: () => item.value?.excerpt || undefined,
		ogType: 'article',
		ogImage: () => ogImage.value,
		articlePublishedTime: () => item.value?.date,
	})
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, notFound.value ? 404 : (error.value?.statusCode ?? 500))
	route.meta.title = notFound.value ? '404' : t('common.temporarilyUnavailable')
}
</script>

<template>
<BlogHeader class="hide-above-mobile" to="/thinking" :suffix="t('common.thinking')" tag="h1" />

<div v-if="item" class="thinking-detail proper-height">
	<ThinkingItem v-bind="item" detail />
	<UtilLink to="/thinking" class="thinking-back">
		<Icon name="tabler:arrow-left" /> {{ t('thinking.allThinking') }}
	</UtilLink>
	<!-- 碎碎念的评论，沿用文章的评论区 -->
	<PostComment v-if="item.allowComment" :key="item.id" :ref-id="item.id" />
</div>

<ZError v-else-if="notFound" icon="line-md:document-delete-twotone" :title="t('common.pageEmptyDoesnt')" />

<ZError v-else icon="tabler:cloud-off" :title="t('thinking.couldntLoadThinking')">
	<template #operation>
		<ZButton :text="t('common.retry')" @click="refresh()" />
	</template>
</ZError>
</template>

<style scoped>
.thinking-detail {
	margin: 1rem;
}

.thinking-back {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	font-size: 0.9em;
	color: var(--c-text-2);

	&:hover {
		color: var(--c-primary);
	}
}
</style>
