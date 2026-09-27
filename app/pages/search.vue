<script setup lang="ts">
/**
 * 搜索页。`?q=` 关键词、`?page=` 页码，服务端渲染；数据与弹窗搜索同一个接口（已处理付费正文）。
 * 搜索结果页不收录
 */
const t = useT()
const route = useRoute()
const router = useRouter()

const keyword = computed(() => typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 50) : '')
const page = useRouteQuery('page', '1', { transform: Number })
const safePage = computed(() => Number.isInteger(page.value) && page.value >= 1 && page.value <= 500 ? page.value : 1)

const { data, error, status, refresh } = await useMxSearch(keyword, safePage)

const input = ref(keyword.value)
watch(keyword, (value) => {
	input.value = value
})

function submit() {
	const q = input.value.trim().slice(0, 50)
	router.push({ query: q ? { q } : {} })
}

useSeoMeta({
	title: () => keyword.value ? t('search.search', { keyword: keyword.value }) : t('common.search'),
	robots: 'noindex, follow',
})
</script>

<template>
<div class="search-page proper-height">
	<div class="mobile-only">
		<BlogHeader to="/" :suffix="t('common.search')" tag="h1" />
	</div>

	<form class="search-form" role="search" @submit.prevent="submit">
		<Icon :name="status === 'pending' ? 'line-md:loading-alt-loop' : 'tabler:search'" />
		<input
			v-model="input"
			type="search"
			name="q"
			maxlength="50"
			:placeholder="t('search.searchPostsDiary')"
			:aria-label="t('search.searchKeywords')"
			enterkeyhint="search"
		>
		<ZButton type="submit" primary :text="t('common.search')" />
	</form>

	<ZError v-if="error" icon="tabler:cloud-off" :title="t('search.searchTemporarilyUnavailable')">
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>
	<p v-else-if="!keyword" class="search-hint">
		{{ t('search.typeKeywordPress') }}
	</p>
	<p v-else-if="data && !data.items.length" class="search-hint">
		{{ t('search.nothingFound', { keyword }) }}
	</p>
	<template v-else-if="data">
		<p class="search-summary">
			{{ t('search.resultsFound', { n: data.total }) }}
		</p>
		<menu class="search-results">
			<PopoverSearchItem
				v-for="item in data.items"
				:key="item.id"
				v-bind="item"
				:query="keyword"
			/>
		</menu>
		<ZPagination v-if="data.totalPages > 1" v-model="page" :total-pages="data.totalPages" />
	</template>
</div>
</template>

<style lang="scss" scoped>
.search-page {
	padding: 1rem;
}

.search-form {
	display: flex;
	align-items: center;
	gap: 0.6em;
	margin: 1rem 0;
	padding: 0.4em 0.4em 0.4em 0.9em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	background-color: var(--c-bg-2);

	&:focus-within {
		border-color: var(--c-primary);
	}

	> input {
		flex-grow: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		font: inherit;
		color: var(--c-text);
	}
}

.search-hint, .search-summary {
	margin: 1rem 0;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.search-hint {
	margin: 3rem 0;
	text-align: center;
}

.search-results :deep(.search-item) {
	margin: 0.2em 0;

	&:hover {
		background-color: var(--c-bg-soft);
	}
}
</style>
