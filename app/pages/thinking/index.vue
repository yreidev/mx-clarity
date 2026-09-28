<script setup lang="ts">
import type { ThinkingPage } from '~/composables/useMxNotes'

const t = useT()
const { data: site } = await useMxSite()
useSeoMeta({ title: () => t('common.thinking'), description: () => t('thinking.thinkingFrom', { site: site.value.title }) })
useHead({ link: [{ rel: 'alternate', type: 'application/atom+xml', href: '/thinking/atom.xml', title: () => t('common.thinking') }] })

const { data, error, refresh } = await useMxThinking()

// 「加载更多」按游标追加，只在浏览器里发生
const loadingMore = ref(false)
const moreError = ref(false)
async function loadMore() {
	if (!data.value?.next || loadingMore.value)
		return
	loadingMore.value = true
	moreError.value = false
	try {
		const more = await $fetch<ThinkingPage>('/api/mx/thinking', { query: { before: data.value.next } })
		data.value = { items: [...data.value.items, ...more.items], next: more.next }
	}
	catch {
		moreError.value = true
	}
	finally {
		loadingMore.value = false
	}
}
</script>

<template>
<BlogHeader class="hide-above-mobile" to="/" :suffix="t('common.thinking')" tag="h1" />

<div class="thinking-list proper-height">
	<ZError v-if="error" icon="tabler:cloud-off" :title="t('thinking.couldntLoadThinking')">
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>
	<p v-else-if="!data?.items.length" class="empty">
		{{ t('thinking.noThinkingPosts') }}
	</p>
	<template v-else>
		<ThinkingItem v-for="item in data.items" :key="item.id" v-bind="item" />
		<div v-if="data.next" class="thinking-more">
			<ZButton :text="loadingMore ? t('common.loading') : (moreError ? t('thinking.failedLoadRetry') : t('thinking.loadMore'))" :disabled="loadingMore" @click="loadMore()" />
		</div>
	</template>
</div>
</template>

<style scoped>
.thinking-list {
	margin: 1rem;
}

.thinking-more {
	display: flex;
	justify-content: center;
	margin: 1.5em 0;
}

.empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}
</style>
