<script setup lang="ts">
/**
 * 草稿预览：站长在 admin 里给草稿开的分享链接。布局与文章页相同，但不进「正在阅读」、
 * 不计阅读、没有评论。链接本身就是凭证，所以不收录、不进共享缓存，页面发出的请求也不带来源网址（`no-referrer`）
 */
const route = useRoute()
const t = useT()
const token = computed(() => String(route.params.token))

const { data: draft, error, refresh } = await useMxDraftPreview(token)
const post = computed(() => draft.value?.article)
const { widgets } = useWidgets(computed<WidgetName[]>(() => post.value ? ['toc'] : ['blog-log']))

const draftNotice = computed(() => ({
	post: t('post.unpublishedDraftPost'),
	note: t('post.unpublishedDraftDiary'),
	page: t('post.unpublishedDraftPage'),
}))
const notFound = computed(() => !post.value && (!error.value || error.value.statusCode === 404))

useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })
useSeoMeta({
	robots: 'noindex, nofollow',
	title: () => post.value ? t('post.preview', { title: post.value.title ?? '' }) : t('post.draftPreview'),
})
if (import.meta.server)
	useResponseHeader('cache-control').value = 'private, no-store'

if (!post.value) {
	const event = useRequestEvent()
	event && setResponseStatus(event, notFound.value ? 404 : error.value?.statusCode ?? 503)
	route.meta.title = notFound.value ? '404' : t('common.temporarilyUnavailable')
}
</script>

<template>
<template #aside>
	<component :is="widget.comp" v-for="widget in widgets" :key="widget.name" />
</template>

<template v-if="post && draft">
	<p class="preview-banner" role="note">
		<Icon name="tabler:eye-edit" />
		<span>{{ draftNotice[draft.kind] }}</span>
	</p>
	<PostHeader v-bind="post" />
	<MxRenderer
		class="article"
		:class="getPostTypeClassName(post.type, { prefix: 'md' })"
		:body="draft.body"
		tag="article"
	/>
</template>

<ZError
	v-else-if="notFound"
	icon="line-md:document-delete-twotone"
	:title="t('common.previewLinkDoesnt')"
/>

<ZError
	v-else
	icon="tabler:cloud-off"
	:title="t('post.previewCantLoaded')"
>
	<template #operation>
		<ZButton :text="t('common.retry')" @click="refresh()" />
	</template>
</ZError>
</template>

<style scoped>
.preview-banner {
	display: flex;
	align-items: center;
	gap: 0.5em;
	margin: 0.5rem;
	padding: 0.6em 1em;
	border: 1px dashed var(--c-primary);
	border-radius: 0.6em;
	background-color: var(--c-primary-soft);
	font-size: 0.9em;

	> .iconify {
		flex-shrink: 0;
		color: var(--c-primary);
	}
}
</style>
