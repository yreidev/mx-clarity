<script setup lang="ts">
/**
 * 标签页：带这个标签的文章，列表样式照归档。数据是缓存的全部文章卡片，按标签筛
 */
const t = useT()
const route = useRoute()
const tag = computed(() => String(route.params.name))

const { data: list, error, refresh } = await useMxPosts()
const articles = computed(() => articlesWithTag(list.value, tag.value))
// 前缀版里标签显示 core 给的译名（地址照旧是原名）
const tagName = computed(() => tagNamesIn(articles.value)[tag.value] ?? tag.value)

const { data: site } = useMxSite()
useSeoMeta({
	title: () => t('post.tag', { tag: tagName.value }),
	description: () => t('post.postsTagged', { site: site.value.title, tag: tagName.value }),
})

if (!articles.value.length) {
	const event = useRequestEvent()
	event && setResponseStatus(event, error.value ? 503 : 404)
	route.meta.title = error.value ? t('common.temporarilyUnavailable') : '404'
}
</script>

<template>
<template #aside>
	<WidgetBlogStats />
	<WidgetBlogLog />
</template>

<div class="tag-page proper-height">
	<div class="mobile-only">
		<BlogHeader to="/" :suffix="`#${tagName}`" tag="h1" />
	</div>

	<template v-if="articles.length">
		<h2 class="tag-title">
			<Icon name="tabler:tag" />
			<span class="tag-name">{{ tagName }}</span>
			<span class="tag-count">{{ t('post.posts', { n: articles.length }) }}</span>
		</h2>
		<menu class="tag-list">
			<PostArchive
				v-for="article in articles"
				:key="article.path"
				v-bind="article"
				:to="article.path"
				show-category
			/>
		</menu>
	</template>

	<ZError
		v-else-if="error"
		icon="tabler:cloud-off"
		:title="t('common.couldntLoadPosts')"
	>
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>

	<ZError
		v-else
		icon="tabler:tag-off"
		:title="t('post.noPostsTag')"
	/>
</div>
</template>

<style lang="scss" scoped>
.tag-page {
	padding: 1rem;
}

.tag-title {
	display: flex;
	align-items: baseline;
	gap: 0.4em;
	margin: 1rem 0;
	font-size: 1.4em;

	> .iconify {
		align-self: center;
		color: var(--c-primary);
	}
}

.tag-name {
	overflow-wrap: anywhere;
}

.tag-count {
	font-size: 0.6em;
	font-weight: normal;
	color: var(--c-text-2);
}
</style>
