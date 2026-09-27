<script setup lang="ts">
/**
 * mx 的文章详情。结构照搬 `[...slug].vue`，数据换成 mx；
 * 正文由服务端解析：Lexical 文章走路径 A（`content` 的 JSON），markdown 文章走路径 B（把 `text` 解析成 AST）。
 */
const t = useT()
const route = useRoute()
const category = computed(() => String(route.params.category))
const slug = computed(() => String(route.params.slug))

// 看 AI 译文的原文：?lang=original；前缀版（/en/...）由路由带上语言
const original = computed(() => route.query.lang === ORIGINAL_LANG)
const { data: detail, error, refresh } = await useMxPost(category, slug, original)
const post = computed(() => detail.value?.article)
// 文章在 core 里的 id（点赞、评论、付费墙都按它）
const postId = computed(() => post.value?.meta?.__id)

// 改过 slug 或分类的文章：旧地址 301 到现在的地址（前缀版跳到同一语言的新地址）
const lang = useRouteLang()
const moved = articleRedirectOf(delocalizePath(route.path), post.value?.path)
if (moved)
	await navigateTo(localePath(moved, lang.value), { redirectCode: 301, replace: true })
// 站长改了这篇就在后台重取；删除或下线了就换成说明
const removed = useLiveContent(postId, refresh)
// 前缀版没有这一语言的译文 → 302 到无前缀地址；hreflang；正文的语言
const { versions, shownLang } = await useLocalizedDetail(() => detail.value && (detail.value.languages ?? UNTRANSLATED), original)

const excerpt = computed(() => post.value?.description || '')
const defaultOgImage = useDefaultOgImage()
const asideWidgetNames = computed<WidgetName[]>(() => {
	if (!post.value)
		return ['blog-stats']
	return (post.value.meta?.aside as WidgetName[] | undefined) ?? ['toc']
})
const { widgets } = useWidgets(asideWidgetNames)

// 草稿（站长登录后能打开）不进房间、不上报阅读，否则它的标题会出现在所有访客的「正在阅读」里
useArticleActivity('post', () => (post.value?.draft ? undefined : postId.value))

// 付费文章：锁定时正文只是 core 截好的预览，下面接付费墙；付完回来时轮询到账
const paywall = computed(() => detail.value?.paywall)
const payment = usePaymentReturn({ locked: () => Boolean(paywall.value?.locked), refresh })

// 限时公开期间：在浏览器里查一次本人是不是会员、买没买过这篇，头部标记据此说明到期后还能不能读
const access = ref<import('~/types/membership').ArticleAccess>()
const core = useCoreClient()
onMounted(() => {
	watch(() => (paywall.value?.reason === 'free-window' ? postId.value : undefined), async (id) => {
		access.value = undefined
		if (id)
			access.value = await fetchArticleAccess(core, id).catch(() => undefined)
	}, { immediate: true })
})

// 限时公开到期：重取一次，由 core 重新判定还能不能读
useRefreshWhenPassed(() => (paywall.value?.reason === 'free-window' ? paywall.value.freeUntil : undefined), refresh)

// 付费文章：读者在别处（评论区、付费墙）登录或退出后重取，正文跟着身份变
const { reader } = useMxReader()
watch(() => readerKeyOf(reader.value), (now, before) => {
	if (paywall.value && before !== undefined && now !== undefined && now !== before)
		refresh()
})

const notFound = computed(() => !post.value && (!error.value || error.value.statusCode === 404))

if (paywall.value && import.meta.server) {
	// 付费文章的页面因人而异（会员看到的是全文），不让任何共享缓存存下
	useResponseHeader('cache-control').value = 'private, no-store'
}

if (post.value) {
	// 文章级元数据全部来自 mx
	useSeoMeta({
		title: () => post.value?.title,
		description: () => post.value?.description,
		ogType: 'article',
		ogImage: () => post.value?.image || defaultOgImage.value,
		articlePublishedTime: () => post.value?.date,
		articleModifiedTime: () => post.value?.updated,
		articleTag: () => post.value?.tags,
		// 看原文是查询参数版的同一篇，不让搜索引擎当成重复页收录（原文语言开了前缀版时那一份才是收录的）
		robots: () => (original.value ? 'noindex' : undefined),
	})
	// useSeoMeta 的类型里没有 keywords；同名的 meta 会盖掉全站的站点关键词（unhead 按 name 去重）
	useHead({
		meta: [{ name: 'keywords', content: () => keywordsText(articleKeywordsOf(post.value?.meta?.keywords, post.value?.tags)) || undefined }],
	})
	const { data: site } = useMxSite()
	useSchemaOrg([defineArticle({
		'@type': 'BlogPosting',
		'headline': () => post.value?.title,
		'description': () => post.value?.description,
		'datePublished': () => post.value?.date,
		'dateModified': () => post.value?.updated,
		'image': () => post.value?.image,
		'author': definePerson({ name: () => site.value.author.name }),
		// 付费文章锁定时正文只有预览
		'isAccessibleForFree': () => !paywall.value?.locked,
		'inLanguage': () => shownLang.value ?? 'zh-CN',
	})])
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, error.value?.statusCode ?? 404)
	route.meta.title = notFound.value ? '404' : t('common.temporarilyUnavailable')
}
</script>

<template>
<template #aside>
	<!-- 更换页面时相同 key 的组件不会更新 -->
	<component :is="widget.comp" v-for="widget in widgets" :key="widget.name" />
</template>

<template v-if="post && detail && !removed">
	<PostHeader v-bind="post" :paywall :access :lang="shownLang" />
	<p v-if="payment === 'unlocked'" class="payment-notice" role="status">
		<Icon name="tabler:circle-check" /> {{ t('post.paymentSuccessfulFull') }}
	</p>
	<p v-else-if="payment === 'timeout'" class="payment-notice" role="status">
		<Icon name="tabler:clock" /> {{ t('post.paymentIsntConfirmed') }}
	</p>
	<PostLanguageSwitch :versions :current="shownLang" />
	<PostTranslationNotice :languages="detail.languages" :original :ref-id="postId" @refresh="refresh()" />
	<PostNotices :extras="detail.extras" :outdated-from="post.updated ?? post.date" />
	<PostTts v-if="postId && detail.extras?.tts" :id="postId" :stale="detail.extras.tts.stale" />
	<PostExcerpt v-if="excerpt" :excerpt />
	<!-- 使用 float-in 动画会导致搜索跳转不准确 -->
	<MxRenderer
		class="article"
		:class="[getPostTypeClassName(post.type, { prefix: 'md' }), { 'paywall-preview': paywall?.locked }]"
		:body="detail.body"
		:lang="shownLang"
		tag="article"
	/>
	<ClientOnly>
		<PostPresence v-if="postId && !post.draft && !paywall?.locked" />
		<!-- 划词与段落评论按原文核对：译文与「看原文」页不出 -->
		<template v-if="postId && !post.draft && !lang && !original">
			<PostSelectionComment />
			<PostCommentHighlights :ref-id="postId" />
			<PostBlockGutter />
		</template>
	</ClientOnly>
	<PostPaywall
		v-if="paywall?.locked && postId"
		:paywall
		:post-id="postId"
		:confirming="payment === 'confirming'"
	/>

	<PostInsights v-if="postId && detail.extras?.insights" :id="postId" />
	<PostActions>
		<PostLike v-if="postId && !paywall?.locked" :id="postId" kind="post" :count="post.likeCount" />
		<PostSubscribe type="post_c" />
	</PostActions>
	<PostRelated :extras="detail.extras" />
	<PostFooter v-bind="post" />
	<PostSurround />
	<PostComment v-if="postId" :key="postId" :ref-id="postId" />
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
	:title="t('post.couldntLoadPost')"
>
	<template #operation>
		<ZButton :text="t('common.retry')" @click="refresh()" />
	</template>
</ZError>
</template>

<style lang="scss" scoped>
.payment-notice {
	display: flex;
	align-items: center;
	gap: 0.4em;
	margin: 0.5rem 1rem;
	padding: 0.6em 1em;
	border-radius: 0.6em;
	background-color: var(--c-primary-soft);
	font-size: 0.9em;
	color: var(--c-text);
}

// 锁定时正文末尾渐隐，接到付费墙
.paywall-preview {
	mask-image: linear-gradient(to bottom, #000 calc(100% - 8em), transparent);
}
</style>
