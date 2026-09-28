<script setup lang="ts">
const t = useT()
const page = useRouteQuery('page', '1', { transform: Number })
const { data: site } = await useMxSite()
useSeoMeta({ title: t('common.quotes'), description: () => t('says.quotesFrom', { site: site.value.title }) })
useHead({ link: [{ rel: 'alternate', type: 'application/atom+xml', href: '/says/atom.xml', title: t('common.quotes') }] })

const { data, error, refresh } = await useMxSays(page)
</script>

<template>
<template #aside>
	<WidgetSay />
	<WidgetBlogStats />
</template>

<BlogHeader class="hide-above-mobile" to="/" :suffix="t('common.quotes')" tag="h1" />

<div class="say-list proper-height">
	<ZError v-if="error" icon="tabler:cloud-off" :title="t('says.quotesCantLoaded')">
		<template #operation>
			<ZButton :text="t('common.retry')" @click="refresh()" />
		</template>
	</ZError>
	<p v-else-if="!data?.items.length" class="empty">
		{{ t('says.noQuotesYet') }}
	</p>
	<template v-else>
		<figure v-for="say in data.items" :id="`say-${say.id}`" :key="say.id" class="say-item card">
			<blockquote>{{ say.text }}</blockquote>
			<figcaption>
				<span v-if="say.author || say.source" class="say-by">
					— {{ [say.author, say.source && t('common.quotedTitle', { source: say.source })].filter(Boolean).join(' ') }}
				</span>
				<UtilDate :date="say.date" icon="tabler:clock" />
			</figcaption>
		</figure>
		<ZPagination v-if="data.totalPages > 1" v-model="page" :total-pages="data.totalPages" />
	</template>
</div>
</template>

<style scoped>
.say-list {
	margin: 1rem;
}

.say-item {
	display: grid;
	gap: 0.6em;
	margin: 1em 0;
	padding: 1em 1.2em;
	border-radius: 0.8em;

	blockquote {
		margin: 0;
		font-family: var(--font-serif);
		font-size: 1.05em;
		white-space: pre-wrap;
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5em;
		font-size: 0.8em;
		color: var(--c-text-2);
	}
}

.empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}
</style>
