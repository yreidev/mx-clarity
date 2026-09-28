<script setup lang="ts">
import { UtilDate } from '#components'
import { likeSite, loadSiteLikes } from '~/utils/mx/home'

const { data: theme } = useMxTheme()
const timeZone = useSiteTimeZone()
const t = useT()
const uiLang = useUiLang()
const lang = useUiLang()

// 数据来自 mx，由缓存的文章列表算出
const { data: stats } = useMxStats()

const yearlyTip = computed(() => Object
	.entries(stats.value?.annual || {})
	.reverse()
	.map(([year, item]) => t('site.postsWords', { year, posts: item.posts, words: formatNumber(item.words, uiLang.value) }))
	.join('\n') || t('site.failedLoadData'),
)

// 建站日期：主题配置里的 since；没填就用最早一篇公开文章或日记的时间，两个都没有就不显示这一项
const since = computed(() => theme.value.since
	|| (stats.value?.firstPublished ? toZonedTemporal(stats.value.firstPublished, timeZone.value).toPlainDate().toString() : ''))

const blogStats = computed(() => [
	...since.value
		? [{ label: t('site.runningFor'), value: timeElapse(since.value, timeZone.value, 2, lang.value), tip: t('site.launchedOn', { date: since.value }) }]
		: [],
	{
	// 原先是主题的构建时间；内容来自 mx 之后，改为最近一篇文章的更新时间
		label: t('site.lastUpdated'),
		value: () => stats.value?.updated
			? h(UtilDate, { date: stats.value.updated, relative: true, tipTransform: (d: string) => t('site.updatedOn', { date: d }) })
			: '--',
	},
	{
		label: t('site.postsDiary2'),
		value: computed(() => stats.value ? `${stats.value.total.posts} / ${stats.value.total.notes}` : '--'),
	},
	{
		label: t('site.wordsPublicPosts'),
		value: computed(() => formatNumber(stats.value?.total?.words, uiLang.value) || '--'),
		tip: yearlyTip,
	},
	...stats.value?.total.reads
		? [{ label: t('site.totalViews'), value: computed(() => formatNumber(stats.value?.total.reads, uiLang.value) || '--'), tip: computed(() => t('site.publicPostsHave', { n: formatNumber(stats.value?.total.likes ?? 0, uiLang.value) })) }]
		: [],
])

// 喜欢本站：浏览器直连 core，core 按 IP 记、每个 IP 只算一次；点过记在本机，按钮变成已喜欢
const core = useCoreClient()
const { data: siteLikes } = useLazyAsyncData('mx-like-site', async () => ({ count: await loadSiteLikes(core()).catch(() => 0) }), { server: false })
const likedSite = useLocalStorage('mx-clarity:liked-site', false)
const liking = ref(false)
async function likeThisSite() {
	if (liking.value || likedSite.value)
		return
	liking.value = true
	try {
		const status = await likeSite(core())
		likedSite.value = true
		if (status === 'liked' && siteLikes.value)
			siteLikes.value = { count: siteLikes.value.count + 1 }
	}
	catch {}
	finally {
		liking.value = false
	}
}
</script>

<template>
<BlogWidget card :title="t('site.blogStats')">
	<template v-if="siteLikes" #action>
		<button
			type="button"
			class="like-site"
			:aria-label="t('site.likeSite')"
			:title="likedSite ? t('site.likedSite') : t('site.likeSite')"
			:aria-pressed="likedSite"
			:disabled="liking"
			@click="likeThisSite"
		>
			<Icon :name="likedSite ? 'tabler:heart-filled' : 'tabler:heart'" />
			<span v-if="siteLikes.count" class="like-site-count">{{ formatNumber(siteLikes.count, uiLang) }}</span>
		</button>
	</template>
	<ZDlGroup :items="blogStats" size="small" />
</BlogWidget>
</template>

<style scoped>
/* 放在标题行右侧，和其他挂件标题行里的操作一样只是个小图标 */
.like-site {
	display: inline-flex;
	align-items: center;
	gap: 0.2em;
	color: var(--c-text-3);
	transition: color 0.1s;

	&:hover:not(:disabled), &[aria-pressed="true"] {
		color: var(--c-primary);
	}
}

.like-site-count {
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
}
</style>
