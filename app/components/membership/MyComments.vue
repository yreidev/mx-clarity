<script setup lang="ts">
import type { MyComment, MyCommentPage } from '~/types/comment'

/**
 * 会员页的「我的评论」：当前读者发过的评论，新的在前，一页 10 条。
 * 状态另以游客身份查：公开了、多半在等审核、悄悄话；查不出的不标
 */
const api = useCommentApi()
const page = ref<MyCommentPage>()
const items = ref<MyComment[]>([])
const loading = ref(false)
const failed = ref(false)
const timeZone = useSiteTimeZone()

async function load(next = 1) {
	if (loading.value)
		return
	loading.value = true
	failed.value = false
	try {
		const res = await api.mine(next)
		page.value = res
		items.value = next === 1 ? res.items : [...items.value, ...res.items.filter(item => !items.value.some(old => old.id === item.id))]
	}
	catch {
		failed.value = true
	}
	finally {
		loading.value = false
	}
}
onMounted(() => load())

const t = useT()
const locale = useUiLocale()
const STATUS = computed<Record<MyComment['status'], string | undefined>>(() => ({
	visible: t('comment.public'),
	pending: t('comment.probablyAwaitingOwners'),
	whisper: t('comment.whisperOnlyOwner'),
	unknown: undefined,
}))
</script>

<template>
<section class="my-comments" aria-labelledby="my-comments-title">
	<h2 id="my-comments-title" class="my-comments-title">
		{{ t('comment.myComments') }}
	</h2>
	<p v-if="failed && !items.length" class="my-comments-empty">
		{{ t('comment.couldntLoadCommentsRight') }}
		<button type="button" class="my-comments-link" @click="load()">
			{{ t('common.retry') }}
		</button>
	</p>
	<p v-else-if="!page" class="my-comments-empty">
		{{ t('common.loading') }}
	</p>
	<p v-else-if="!items.length" class="my-comments-empty">
		{{ t('comment.noCommentsYet') }}
	</p>
	<template v-else>
		<ul class="my-comments-list">
			<li v-for="item in items" :key="item.id" class="my-comment">
				<div class="my-comment-meta">
					<UtilLink v-if="item.path" :to="item.path" class="my-comment-source">
						{{ item.title || t('comment.original') }}
					</UtilLink>
					<span v-else class="my-comment-source gone">{{ t('comment.originalDeleted') }}</span>
					<time v-if="item.date" :datetime="item.date">{{ toZonedLocaleString(item.date, timeZone, 'date', locale) }}</time>
					<span v-if="STATUS[item.status]" class="my-comment-status" :class="item.status">{{ STATUS[item.status] }}</span>
				</div>
				<CommentBody :body="item.body" />
			</li>
		</ul>
		<div v-if="page.page < page.totalPages" class="my-comments-more">
			<ZButton :text="loading ? t('common.loading') : failed ? t('comment.couldntLoadClick') : t('common.more')" :disabled="loading" @click="load(page.page + 1)" />
		</div>
	</template>
</section>
</template>

<style lang="scss" scoped>
.my-comments-title {
	margin-bottom: 0.6em;
	font-size: 1.2em;
}

.my-comments-empty {
	margin: 1rem 0;
	text-align: center;
	color: var(--c-text-2);
}

.my-comments-link {
	color: var(--c-primary);

	&:hover {
		text-decoration: underline;
	}
}

.my-comments-list {
	display: grid;
	gap: 1em;
	margin: 0;
	padding: 0;
	list-style: none;
}

.my-comment {
	padding: 0.6em 0.8em;
	border-radius: 0.6em;
	background-color: var(--c-bg-2);
}

.my-comment-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.2em 0.8em;
	font-size: 0.85em;
	color: var(--c-text-3);
}

.my-comment-source {
	overflow-wrap: anywhere;
	font-weight: 600;
	color: var(--c-primary);

	&.gone {
		font-weight: normal;
		color: var(--c-text-3);
	}
}

.my-comment-status {
	padding: 0 0.4em;
	border-radius: 0.3em;
	background-color: var(--c-bg);

	&.visible {
		color: var(--c-primary);
	}
}

.my-comments-more {
	margin-top: 1em;
	text-align: center;
}
</style>
