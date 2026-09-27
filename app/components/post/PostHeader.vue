<script setup lang="ts">
import type { ArticleProps } from '~/types/article'
import type { ArticleAccess, ArticlePaywall } from '~/types/membership'

defineOptions({ inheritAttrs: false })
const props = defineProps<ArticleProps & {
	/** 付费文章的付费墙，决定头部的付费标记 */
	paywall?: ArticlePaywall
	/** 限时公开期间本人到期后还能不能读（浏览器里查到才有） */
	access?: ArticleAccess
}>()

const { data: site } = useMxSite()
const t = useT()
// 文章地址是 /posts/<分类 slug>/<slug>：分类名链到分类页；日记等别的内容没有分类页
const categoryPath = computed(() => {
	const slug = props.path?.match(/^\/posts\/([^/]+)\/[^/]+$/)?.[1]
	return slug ? `/posts/${slug}` : undefined
})

// 站长在前台登录时给一个「在后台编辑」（读者状态只在浏览器里取，站长的 cookie 不经主题转发）
const { reader } = useMxReader()
const { data: theme } = useMxTheme()
const adminEditUrl = computed(() => reader.value?.reader?.isOwner
	? adminEditUrlOf({ adminUrl: theme.value.adminUrl, webUrl: site.value.webUrl, path: props.path, id: props.meta?.__id })
	: undefined)

const coverFilter = computed(() => props.meta?.coverFilter || (props.meta?.coverDim && 'brightness(0.75)') || undefined)

const shareText = `${t('post.siteTitle', { site: site.value.title, title: props.title ?? '' })}\n\n${
	props.description ? `${props.description}\n\n` : ''}${
	new URL(props.path!, site.value.webUrl).href}`

const { copy, copied } = useCopy(shareText)

// 阅读次数：先用页面数据里的，收到实时更新就换成新的。独立页没有阅读次数
const live = useMxLive()
const readKind = computed(() => props.path?.startsWith('/notes/') ? 'note' : props.path?.startsWith('/posts/') ? 'post' : undefined)
const shownReadCount = computed(() => {
	const id = props.meta?.__id
	const kind = readKind.value
	return (id && kind ? live.readCountOf(kind, id) : undefined) ?? props.readCount
})

// 此刻有几人在读这篇（含自己）：和侧栏「阅读」共用一份数据，只在浏览器里取，每分钟刷新
const { data: readingBoard, refresh: refreshReading } = useMxReadingBoard()
const readersNow = computed(() => (props.path && readKind.value ? readingBoard.value?.counts?.[props.path] ?? 0 : 0))
useIntervalFn(() => readKind.value && refreshReading(), 60_000)

// 付费标记；锁定时正文只是预览，字数不准，不显示
const now = useRenderNow()
const timeZone = useSiteTimeZone()
const locale = useUiLocale()
const uiLang = useUiLang()
const paywallBadge = computed(() => props.paywall && paywallBadgeOf(props.paywall, now.value, props.access, uiLang.value))
// 限时公开：悬停时写明到期的具体时间，以及到期后本人还能不能读
const paywallTip = computed(() => props.paywall?.reason === 'free-window'
	? { content: freeWindowTipOf(props.paywall.freeUntil, props.access, date => toZonedLocaleString(date, timeZone.value, 'full', locale.value), uiLang.value) }
	// 别的标记没有说明，不弹空提示框
	: { onShow: () => false as const })
</script>

<template>
<div class="post-header" :class="{ 'has-cover': image }">
	<Pic v-if="image" class="post-cover" :src="image" :alt="title" :filter="coverFilter" />
	<div class="post-nav">
		<div class="operations">
			<Icon v-show="false" name="tabler:check" />
			<ZButton
				:icon="copied ? 'tabler:check' : 'tabler:share'"
				:text="t('post.shareText')"
				@click="copy()"
			/>
		</div>

		<div v-if="!meta?.hideInfo" class="post-info">
			<UtilDate
				v-if="date"
				v-tip
				:tip-transform="d => t('post.createdOn', { date: d })"
				:date
				icon="tabler:pencil-minus"
			/>

			<UtilDate
				v-if="updated && isTimeDiffSignificant(date, updated, 1)"
				v-tip
				:tip-transform="d => t('post.updatedOn', { date: d })"
				:date="updated"
				icon="tabler:clock-edit"
			/>

			<UtilLink v-if="categories && categoryPath" :to="categoryPath" class="post-category">
				<Icon :name="getCategoryIcon(categories[0])" />
				{{ categories[0] }}
			</UtilLink>
			<span v-else-if="categories">
				<Icon :name="getCategoryIcon(categories[0])" />
				{{ categories[0] }}
			</span>

			<span v-if="!paywall?.locked">
				<Icon name="tabler:pilcrow" />
				{{ t('post.words', { n: formatNumber(readingTime?.words, uiLang) }) }}
			</span>

			<span v-if="shownReadCount !== undefined">
				<Icon name="tabler:eye" />
				{{ t('post.views', { n: formatNumber(shownReadCount, uiLang) }) }}
			</span>

			<span v-if="readersNow > 1" class="post-readers-now">
				<Icon name="tabler:users" />
				{{ t('post.peopleReadingNow', { n: readersNow }) }}
			</span>

			<span v-if="paywallBadge" v-tip="paywallTip" class="post-paywall-badge">
				<Icon :name="paywallBadge.icon" />
				{{ paywallBadge.text }}
			</span>

			<a v-if="adminEditUrl" :href="adminEditUrl" class="post-admin-edit" target="_blank" rel="noopener">
				<Icon name="tabler:edit" />
				{{ t('post.editDashboard') }}
			</a>
		</div>

		<!-- 隐藏了文章信息时，付费标记照样要让读者看到 -->
		<div v-else-if="paywallBadge" class="post-info">
			<span v-tip="paywallTip" class="post-paywall-badge">
				<Icon :name="paywallBadge.icon" />
				{{ paywallBadge.text }}
			</span>
		</div>
	</div>

	<h1 class="post-title" :class="getPostTypeClassName(type)">
		{{ title }}
	</h1>
</div>
</template>

<style lang="scss" scoped>
.post-header {
	contain: paint; // overflow hidden + position relative
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	gap: 1rem;
	margin: 0.5rem;
	border-radius: 1rem;
	background-color: var(--c-bg-2);
	color: var(--c-text);

	@media (max-width: $breakpoint-mobile) {
		margin: 0;
		border-radius: 0;
	}

	&:hover .operations,
	&:focus-within .operations {
		opacity: 1;
	}

	&.has-cover {
		min-height: 16rem;
		max-height: 20rem;
		color: white;
		transition: font-size 0.2s;

		.post-info {
			filter: drop-shadow(0 1px 2px #000);
		}

		.post-title {
			background-image: linear-gradient(transparent, #0003, #0005);
			text-shadow: var(--text-shadow-black);

			&.text-story {
				text-align: center;
			}
		}
	}
}

.operations {
	position: absolute;
	opacity: 0;
	inset-inline-end: 1em;
	color: var(--c-text-1);
	transition: opacity 0.2s;
	z-index: 1;
}

.post-cover {
	position: absolute;
	inset: 0;

	> :deep(img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
}

.post-title {
	padding: 0.8em 1rem;
	font-size: 1.6em;
	line-height: 1.2;
	z-index: 1;
}

.post-nav {
	padding: 0.8em 1rem;
	font-size: 0.8em;

	.post-info {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5em 1.2em;
		column-gap: clamp(1em, 3%, 1.5em);
	}

	.post-paywall-badge {
		padding: 0 0.5em;
		border-radius: 0.4em;
		background-color: var(--c-primary-soft);
		color: var(--c-primary);
	}
}

.has-cover .post-paywall-badge {
	background-color: #0006;
	color: white;
}
</style>
