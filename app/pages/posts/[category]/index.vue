<script setup lang="ts">
import { groupBy } from 'es-toolkit/array'

/**
 * 分类独立页：分类名做标题，文章按年分组（与归档同一种条目）。数据是缓存的全站文章列表，不多打 core。
 * `/categories/:slug` 由 routeRules 转到这里；缓存列表里没有这个分类（一篇都没有）就是 404
 */
const t = useT()
const route = useRoute()
const { data: site } = useMxSite()
const { data: list, error } = await useMxPosts()
const slug = computed(() => String(route.params.category))
const name = computed(() => categoryNameOf(list.value, slug.value))
const timeZone = useSiteTimeZone()

const articles = computed(() => (name.value ? list.value.filter(article => article.categories?.[0] === name.value) : [])
	.toSorted((a, b) => Date.parse(b.date ?? '') - Date.parse(a.date ?? '')))

/** 按站点时区分年：同一时刻在不同时区可能跨年 */
function yearOf(date?: string) {
	try {
		return date ? String(toZonedTemporal(date, timeZone.value).year) : ''
	}
	catch {
		return ''
	}
}
const groups = computed(() => Object.entries(groupBy(articles.value, article => yearOf(article.date)))
	.sort(([a], [b]) => Number(b) - Number(a)))

const unavailable = !name.value && Boolean(error.value)
if (name.value) {
	useSeoMeta({
		title: () => name.value,
		description: () => t('post.postsCategory', { site: site.value.title, category: name.value ?? '', n: articles.value.length }),
	})
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, unavailable ? 503 : 404)
	route.meta.title = unavailable ? t('common.temporarilyUnavailable') : '404'
}
</script>

<template>
<div v-if="name" class="category-page proper-height">
	<header class="category-header">
		<h1 class="text-creative">
			<Icon :name="getCategoryIcon(name)" /> {{ name }}
		</h1>
		<p>{{ t('post.posts2', { n: articles.length }) }}</p>
	</header>

	<section v-for="[year, group] in groups" :key="year" class="category-year" :aria-labelledby="`category-year-${year}`">
		<h2 :id="`category-year-${year}`" class="category-year-title">
			{{ year }}
		</h2>
		<menu class="archive-list">
			<PostArchive v-for="article in group" :key="article.path" v-bind="article" :to="article.path" />
		</menu>
	</section>
</div>

<ZError
	v-else-if="!unavailable"
	icon="line-md:document-delete-twotone"
	:title="t('post.categoryNotFound')"
/>
<ZError
	v-else
	icon="tabler:cloud-off"
	:title="t('common.couldntLoadPosts')"
/>
</template>

<style scoped>
.category-page {
	padding: 1rem;
}

.category-header {
	margin: 1rem 0 2rem;

	h1 {
		display: flex;
		align-items: center;
		gap: 0.3em;
		font-size: 1.8em;
	}

	p {
		margin: 0.3em 0 0;
		color: var(--c-text-2);
	}
}

.category-year {
	margin: 1rem 0 2.5rem;
}

.category-year-title {
	margin-bottom: 0.5em;
	font-size: 1.3em;
	color: var(--c-text-3);
}

.archive-list {
	margin: 0;
	padding: 0;
}
</style>
