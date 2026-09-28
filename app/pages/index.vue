<script setup lang="ts">
import { orderBy } from 'es-toolkit/array'

const t = useT()
// 站点级 SEO 以 mx 后台为准，core 不可用时 useMxSite 自己退到 blog.config
const { data: site } = await useMxSite()
const ogImage = useDefaultOgImage()
useSeoMeta({
	description: () => site.value.description,
	ogImage: () => ogImage.value,
})
// 站长资料里的社交账号进结构化数据的 sameAs
useSchemaOrg([definePerson(computed(() => ({
	name: site.value.author.name,
	...(site.value.author.avatar ? { image: site.value.author.avatar } : {}),
	sameAs: site.value.social.filter(item => item.url.startsWith('https://')).map(item => item.url),
})))])

const { data: listRaw, error: listError, refresh: refreshList } = await useMxPosts()
const { listSorted, isAscending, sortOrder } = useArticleSort(listRaw, { bindDirectionQuery: 'asc', bindOrderQuery: 'sort' })
const { category, categories, listCategorized } = useArticleCategory(listSorted, { bindQuery: 'category' })
const { page, totalPages, listPaged } = usePagination(listCategorized, { bindQuery: 'page' })

useSeoMeta({ title: () => (page.value > 1 ? t('site.page', { page: page.value }) : '') })

const listRecommended = computed(() => orderBy(
	// mx 映射后缺省是 undefined（Nuxt Content 时代是 null）
	listRaw.value.filter(item => item.recommend != null),
	['recommend', 'date'],
	['desc'],
))
</script>

<template>
<template #aside>
	<WidgetBlogStats />
	<WidgetActivity />
	<WidgetBlogTech />
</template>

<BlogHeader class="hide-above-mobile" to="/" tag="h1" />

<BlogUpdates />

<PostSlide v-if="listRecommended.length && page === 1 && !category" :list="listRecommended" />

<div class="post-list">
	<PostOrderToggle
		v-model:is-ascending="isAscending"
		v-model:sort-order="sortOrder"
		v-model:category="category"
		:categories
		@update:category="page = 1"
	/>

	<ZError
		v-if="listError"
		icon="tabler:cloud-off"
		:title="t('common.couldntLoadPosts')"
	>
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refreshList()" />
		</template>
	</ZError>

	<UtilListTransition v-slot="{ items, state }" :items="listPaged" :state="sortOrder">
		<menu class="proper-height">
			<PostArticle
				v-for="article, index in items"
				:key="article.path"
				:data-list-key="article.path"
				v-bind="article"
				:to="article.path"
				:use-updated="state === 'updated'"
				:style="getFixedDelay(index * 0.05)"
			/>
		</menu>
	</UtilListTransition>

	<ZPagination v-model="page" sticky avoid :total-pages="totalPages" />
</div>
</template>

<style scoped>
.post-list {
	margin: 1rem;
}
</style>
