<script setup lang="ts">
/**
 * 日记详情：`/notes/:nid`。日期加 slug 的地址（`/notes/年/月/日/slug`）先换成 nid，再 301 过去
 */
const route = useRoute()
const t = useT()
{
	const path = route.params.path
	if (Array.isArray(path) && path.length === 4) {
		const [year, month, day, slug] = path
		const found = await useRequestFetch()<{ nid: number }>('/api/mx/notes/by-date', { query: { year, month, day, slug } }).catch(() => undefined)
		if (found)
			await navigateTo(localePath(`/notes/${found.nid}`, routeLangOf(route.params.lang)), { redirectCode: 301, replace: true })
	}
}
const timeZone = useSiteTimeZone()
const locale = useUiLocale()
const defaultOgImage = useDefaultOgImage()
const nid = computed(() => {
	const path = route.params.path
	const first = Array.isArray(path) ? path[0] : path
	return Array.isArray(path) && path.length === 1 && /^\d{1,9}$/.test(first ?? '') ? Number(first) : 0
})

// 地址不是 /notes/:nid 时 nid 为 0，服务端对它返回 404
// 看 AI 译文的原文：?lang=original；前缀版（/en/...）由路由带上语言
const original = computed(() => route.query.lang === ORIGINAL_LANG)
const { data: detail, error, refresh } = await useMxNote(nid, original)
const note = computed(() => (detail.value && !detail.value.locked && !('scheduled' in detail.value) ? detail.value : undefined))
// 定时公开、还没到时间：只有公开时间
const scheduled = computed(() => (detail.value && 'scheduled' in detail.value ? detail.value : undefined))

// PostHeader 按文章的形状取值：专栏名当分类，排版用 story
const header = computed(() => note.value && {
	title: note.value.note.title,
	date: note.value.note.date,
	updated: note.value.note.updated,
	categories: [note.value.note.topic?.name ?? t('common.diary')],
	readingTime: note.value.note.readingTime,
	type: 'story' as const,
	path: note.value.note.path,
	readCount: note.value.note.readCount,
	image: note.value.note.cover,
	meta: { __id: note.value.note.meta.__id },
})

// 站长改了这篇就在后台重取；删除或下线了就换成说明
const removed = useLiveContent(() => note.value?.note.meta.__id, refresh)
// 前缀版没有这一语言的译文 → 302 到无前缀地址；hreflang；正文的语言
const { versions, shownLang } = await useLocalizedDetail(() => note.value && (note.value.languages ?? UNTRANSLATED), original)

// 解锁进来的加密日记不进「正在阅读」的房间，否则它的标题会出现在侧栏里
const unlocked = ref(false)
useArticleActivity('note', () => note.value?.note.meta.__id, { presence: () => !unlocked.value })

const { widgets } = useWidgets(computed<WidgetName[]>(() => (note.value ? ['toc', 'note-around'] : ['blog-stats'])))

const notFound = computed(() => !detail.value && (!error.value || error.value.statusCode === 404))

if (note.value) {
	useSeoMeta({
		title: () => note.value?.note.title,
		description: () => note.value?.note.excerpt,
		ogType: 'article',
		ogImage: () => note.value?.note.cover || defaultOgImage.value,
		articlePublishedTime: () => note.value?.note.date,
		robots: () => (original.value ? 'noindex' : undefined),
	})
}
else if (detail.value?.locked) {
	useSeoMeta({ title: t('common.passwordProtectedDiary'), robots: 'noindex' })
}
else if (scheduled.value) {
	useSeoMeta({ title: t('common.scheduledDiaryEntry'), robots: 'noindex' })
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, notFound.value ? 404 : (error.value?.statusCode ?? 500))
	route.meta.title = notFound.value ? '404' : t('common.temporarilyUnavailable')
}
// 「将在 {time} 公开」按占位拆成两段，中间放 <time>
const scheduledText = computed(() => t('note.goesPublic').split('{time}'))

// 一天之内就公开的，到点在浏览器里自动重取
const DAY = 86_400_000
let dueTimer: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
	watch(scheduled, (value) => {
		clearTimeout(dueTimer)
		const left = value ? Date.parse(value.publicAt) - Date.now() : Number.NaN
		if (left > 0 && left < DAY)
			dueTimer = setTimeout(refresh, left + 2000)
	}, { immediate: true })
})
onBeforeUnmount(() => clearTimeout(dueTimer))

function onUnlocked(opened: import('~/types/note').NoteDetail) {
	unlocked.value = true
	detail.value = opened
}
</script>

<template>
<template #aside>
	<component :is="widget.comp" v-for="widget in widgets" :key="widget.name" />
</template>

<template v-if="note && header && !removed">
	<PostHeader v-bind="header" :lang="shownLang" />
	<NoteMeta class="note-detail-meta" v-bind="note.note" />
	<PostLanguageSwitch :versions :current="shownLang" />
	<PostTranslationNotice :languages="note.languages" :original :ref-id="note.note.meta.__id" @refresh="refresh()" />
	<PostNotices :extras="note.extras" />
	<PostTts v-if="note.extras?.tts" :id="note.note.meta.__id" :stale="note.extras.tts.stale" />
	<MxRenderer class="article md-story" :body="note.body" :lang="shownLang" tag="article" />
	<ClientOnly>
		<template v-if="!unlocked">
			<PostPresence />
			<!-- 划词与段落评论按原文核对：译文与「看原文」页不出 -->
			<template v-if="!routeLangOf(route.params.lang) && !original">
				<PostSelectionComment />
				<PostCommentHighlights :ref-id="note.note.meta.__id" />
				<PostBlockGutter />
			</template>
		</template>
	</ClientOnly>
	<PostInsights v-if="note.extras?.insights" :id="note.note.meta.__id" />
	<PostActions>
		<PostLike :id="note.note.meta.__id" kind="note" :count="note.note.likeCount" />
		<PostSubscribe type="note_c" />
	</PostActions>
	<NoteSurround :newer="note.newer" :older="note.older" />
	<PostComment :key="note.note.meta.__id" :ref-id="note.note.meta.__id" />
</template>

<ZError v-else-if="removed" icon="tabler:file-off" :title="t('common.hasBeenDeleted')">
	<template #operation>
		<ZButton :text="t('common.backHome')" to="/" />
	</template>
</ZError>

<NotePassword v-else-if="detail?.locked" :nid="detail.nid" :original @unlocked="onUnlocked" />

<ZError v-else-if="scheduled" icon="tabler:clock-hour-4" :title="t('note.diaryEntryIsnt')">
	<p class="note-scheduled">
		{{ scheduledText[0] }}<time :datetime="scheduled.publicAt">{{ toZonedLocaleString(scheduled.publicAt, timeZone, 'full', locale) }}</time>{{ scheduledText[1] }}
	</p>
</ZError>

<ZError
	v-else-if="notFound"
	icon="line-md:document-delete-twotone"
	:title="t('common.pageEmptyDoesnt')"
/>

<ZError v-else icon="tabler:cloud-off" :title="t('note.couldntLoadDiary')">
	<template #operation>
		<ZButton :text="t('common.retry')" @click="refresh()" />
	</template>
</ZError>
</template>

<style scoped>
.note-detail-meta {
	margin: 0.5rem 1.5rem 0;
}

.note-scheduled {
	color: var(--c-text-2);
}
</style>
