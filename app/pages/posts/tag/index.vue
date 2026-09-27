<script setup lang="ts">
/**
 * 标签总览：全部标签与各自的篇数，由缓存的文章列表统计，不多打 core。字号按篇数分四档
 */
const t = useT()
const { data: list, error, refresh } = await useMxPosts()
const tags = computed(() => tagCountsOf(list.value))
// 前缀版里显示 core 给的标签译名，链接照旧按原名
const names = computed(() => tagNamesIn(list.value))
const max = computed(() => Math.max(1, ...tags.value.map(tag => tag.count)))
const sizeOf = (count: number) => 0.9 + Math.round(count / max.value * 3) * 0.15

const { data: site } = useMxSite()
useSeoMeta({
	title: t('common.allTags'),
	description: () => t('post.allTags', { site: site.value.title, n: tags.value.length }),
})
if (!tags.value.length && error.value) {
	const event = useRequestEvent()
	event && setResponseStatus(event, 503)
}
</script>

<template>
<template #aside>
	<WidgetBlogStats />
</template>

<div class="tags-page proper-height">
	<div class="mobile-only">
		<BlogHeader to="/" :suffix="t('post.tags')" tag="h1" />
	</div>

	<h2 class="tags-title">
		<Icon name="tabler:tags" />
		{{ t('common.allTags') }}
		<span class="tags-count">{{ t('post.count', { n: tags.length }) }}</span>
	</h2>

	<ul v-if="tags.length" class="tags-cloud">
		<li v-for="tag in tags" :key="tag.name">
			<UtilLink :to="tagPath(tag.name)" :style="{ fontSize: `${sizeOf(tag.count)}em` }">
				#{{ names[tag.name] ?? tag.name }}<sup>{{ tag.count }}</sup>
			</UtilLink>
		</li>
	</ul>
	<ZError v-else-if="error" icon="tabler:cloud-off" :title="t('common.couldntLoadPosts')">
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>
	<p v-else class="tags-empty">
		{{ t('post.noTagsYet') }}
	</p>
</div>
</template>

<style lang="scss" scoped>
.tags-page {
	padding: 1rem;
}

.tags-title {
	display: flex;
	align-items: center;
	gap: 0.4em;
	margin: 1rem 0 1.5rem;
	font-size: 1.4em;

	> .iconify {
		color: var(--c-primary);
	}
}

.tags-count {
	font-size: 0.6em;
	font-weight: normal;
	color: var(--c-text-2);
}

.tags-cloud {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 0.5em 1em;
	margin: 0;
	padding: 0;
	list-style: none;

	a {
		overflow-wrap: anywhere;
		color: var(--c-text-2);
		transition: color 0.1s;

		&:hover {
			color: var(--c-primary);
		}
	}

	sup {
		margin-inline-start: 0.1em;
		font-size: 0.6em;
		color: var(--c-text-3);
	}
}

.tags-empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}
</style>
