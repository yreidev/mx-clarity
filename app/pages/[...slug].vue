<script setup lang="ts">
/**
 * mx 的独立页，布局与文章页相同。
 * 静态路由优先匹配，这里只接住其余的一段式地址；多段地址直接 404。
 */
const t = useT()
const route = useRoute()
const segments = computed(() => [route.params.slug ?? []].flat().filter(Boolean))
const slug = computed(() => segments.value.length === 1 ? String(segments.value[0]) : '')

// 看 AI 译文的原文：?lang=original；前缀版（/en/...）由路由带上语言
const original = computed(() => route.query.lang === ORIGINAL_LANG)
const { data: detail, error, refresh } = await useMxPage(slug, { original })
const post = computed(() => detail.value?.article)
// 站长改了这篇就在后台重取；删除或下线了就换成说明
const removed = useLiveContent(() => post.value?.meta?.__id, refresh)
// 前缀版没有这一语言的译文 → 302 到无前缀地址；hreflang；正文的语言
const { versions, shownLang } = await useLocalizedDetail(() => detail.value && (detail.value.languages ?? UNTRANSLATED), original)

const excerpt = computed(() => post.value?.description || '')
const asideWidgetNames = computed<WidgetName[]>(() => {
	if (!post.value)
		return ['blog-stats']
	return (post.value.meta?.aside as WidgetName[] | undefined) ?? ['toc']
})
const { widgets } = useWidgets(asideWidgetNames)

useArticleActivity('page', () => post.value?.meta?.__id)

const notFound = computed(() => !post.value && (!error.value || error.value.statusCode === 404))
const defaultOgImage = useDefaultOgImage()

if (post.value) {
	useSeoMeta({
		title: () => post.value?.title,
		description: () => post.value?.description,
		ogType: 'article',
		ogImage: () => post.value?.image || defaultOgImage.value,
		robots: () => (original.value ? 'noindex' : undefined),
	})
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, notFound.value ? 404 : error.value?.statusCode ?? 503)
	route.meta.title = notFound.value ? '404' : t('common.temporarilyUnavailable')
}
</script>

<template>
<template #aside>
	<!-- 每篇文章拥有独立的目录状态，并在具名插槽内自然入场。 -->
	<component :is="widget.comp" v-for="widget in widgets" :key="`${post?.path ?? route.path}:${widget.name}`" />
</template>

<template v-if="post && detail && !removed">
	<PostHeader v-bind="post" :lang="shownLang" />
	<PostLanguageSwitch :versions :current="shownLang" />
	<PostTranslationNotice :languages="detail.languages" :original :ref-id="post.meta?.__id" @refresh="refresh()" />
	<PostExcerpt v-if="excerpt" :excerpt />
	<!-- 正文使用纯透明度入场，保证 URL 锚点和目录测量不受位移影响。 -->
	<MxRenderer
		class="article"
		data-transition-enter
		:class="getPostTypeClassName(post.type, { prefix: 'md' })"
		:body="detail.body"
		:lang="shownLang"
		tag="article"
	/>

	<PostComment v-if="post.meta?.__id" :key="post.meta.__id" :ref-id="post.meta.__id" />
</template>

<ZError v-else-if="removed" icon="tabler:file-off" :title="t('common.hasBeenDeleted')">
	<template #operation>
		<ZButton :text="t('common.backHome')" to="/" />
	</template>
</ZError>

<ZError
	v-else-if="notFound"
	icon="line-md:document-delete-twotone"
	:title="t('common.pageEmptyDoesnt')"
/>

<ZError
	v-else
	icon="tabler:cloud-off"
	:title="t('post.pageCantLoaded')"
>
	<template #operation>
		<ZButton :text="t('common.retry')" @click="refresh()" />
	</template>
</ZError>
</template>
