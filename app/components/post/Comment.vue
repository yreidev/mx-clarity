<script setup lang="ts">
import type { TippyComponent } from 'vue-tippy'
import type { CommentSort, CommentSubmitResult, CommentThread } from '~/types/comment'

/**
 * 评论区：接 mx 的评论，取代上游的 Twikoo。
 * 滚动到附近时才加载；失败只影响这一块。外链点击先弹确认气泡，这部分沿用上游。
 * 带 `#comment-<id>` 打开时直接加载并定位到那一条（不在已加载的几页里就单独取它那层楼，放在最上面）
 */
const props = defineProps<{
	/** 文章 / 日记在 mx 里的 id */
	refId: string
}>()

const t = useT()
const api = useCommentApi()
const { data: site } = useMxSite()

const commentEl = useTemplateRef('comment')
const popoverEl = useTemplateRef<TippyComponent>('popover')
const popoverJumpTo = ref('')
const popoverInputEl = useTemplateRef('popover-input')
const showUndo = ref(false)

const popoverBind = ref<TippyComponent['$props']>({})

/** 评论区链接守卫 */
useEventListener(commentEl, 'click', (e) => {
	if (!(e.target instanceof Element))
		return

	const popoverTarget = e.target.closest('a[target="_blank"]')
	if (!(popoverTarget instanceof HTMLAnchorElement))
		return

	e.preventDefault()
	popoverEl.value?.hide()

	popoverJumpTo.value = safelyDecodeUriComponent(popoverTarget.href)
	popoverBind.value = {
		getReferenceClientRect: () => popoverTarget.getBoundingClientRect(),
		triggerTarget: popoverTarget,
	}

	nextTick(checkUndoable)
	popoverEl.value?.show()
}, { capture: true })

function checkUndoable() {
	showUndo.value = popoverInputEl.value?.textContent !== popoverJumpTo.value
}

function undo() {
	if (!popoverInputEl.value)
		return
	popoverInputEl.value.textContent = popoverJumpTo.value
	checkUndoable()
}

function confirmOpen() {
	const url = popoverInputEl.value?.textContent?.trim() ?? ''
	// 地址框可以改，打开前再过一次协议白名单；noopener 免得新页面拿到本页的 window.opener
	if (/^https?:\/\//i.test(url))
		window.open(url, '_blank', 'noopener,noreferrer')
}

const status = computed(() => {
	if (site.value.source === 'static')
		return 'unavailable'
	return site.value.comments.enabled ? 'open' : 'closed'
})

const phase = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const threads = ref<CommentThread[]>([])
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)
const loadingMore = ref(false)
const moreFailed = ref(false)
const notice = ref('')

const SORTS = computed<{ value: CommentSort, label: string }[]>(() => [
	{ value: 'pinned', label: t('comment.default') },
	{ value: 'newest', label: t('comment.newest') },
	{ value: 'oldest', label: t('comment.oldest') },
])
const sort = useLocalStorage<CommentSort>('mx-clarity:comment-sort', 'pinned')
const currentSort = computed<CommentSort>(() => SORTS.value.some(item => item.value === sort.value) ? sort.value : 'pinned')

// 读者身份全站共用一份：在这里退出，付费墙和会员页也跟着变
const shared = useMxReader()
const reader = computed(() => shared.reader.value ?? { reader: null, providers: [] })
const replyingTo = ref<string>()
const highlighted = ref<string>()
/** 单独取来放在最上面的那层楼：换个 key，楼层原本就在列表里时也按新数据重建（楼中楼组件只在创建时读回复） */
const locatedRoot = ref<string>()

async function refreshReader() {
	await shared.refresh()
}

provide(commentContextKey, {
	refId: props.refId,
	reader,
	allowGuest: computed(() => site.value.comments.allowGuest),
	replyingTo,
	highlighted,
	refreshReader,
	reload: () => load(),
})

async function load() {
	phase.value = 'loading'
	try {
		const [first] = await Promise.all([api.page(props.refId, 1, currentSort.value), refreshReader()])
		threads.value = first.items
		page.value = 1
		totalPages.value = first.totalPages
		total.value = first.total
		phase.value = 'ready'
	}
	catch {
		phase.value = 'error'
	}
}

async function loadMore() {
	if (loadingMore.value)
		return
	loadingMore.value = true
	moreFailed.value = false
	try {
		const next = await api.page(props.refId, page.value + 1, currentSort.value)
		// 本页新发的评论会把后面的挤下去一格，去重
		const seen = new Set(threads.value.map(thread => thread.id))
		threads.value.push(...next.items.filter(thread => !seen.has(thread.id)))
		page.value = next.page
		totalPages.value = next.totalPages
	}
	catch {
		moreFailed.value = true
	}
	finally {
		loadingMore.value = false
	}
}

function onSubmitted(result: CommentSubmitResult) {
	if (result.status !== 'visible')
		return
	// 实时推送可能先到：换成接口返回的这份（带编辑用的原文），不重复计数
	const at = threads.value.findIndex(thread => thread.id === result.comment.id)
	if (at >= 0) {
		threads.value[at] = { ...threads.value[at]!, ...result.comment, fresh: undefined }
		return
	}
	threads.value.unshift({ ...result.comment, replies: [] })
	total.value++
}

/**
 * 别人刚发的顶层评论（实时连接只映射这一篇的、不是悄悄话的）：按 id 去重，插在排序对应的位置并标「新」。
 * 按「最早」排且后面还有没加载的页时不插（它在最后一页），只加计数。回复由各层楼自己接
 */
/** 页面在后台时来了新评论：标签页标题前加计数，回到页面就恢复 */
let unseen = 0
let originalTitle = ''
function markUnseen() {
	if (!document.hidden)
		return
	if (!unseen)
		originalTitle = document.title
	unseen++
	document.title = t('comment.newComments', { n: unseen, title: originalTitle })
}
useEventListener(() => (import.meta.client ? document : undefined), 'visibilitychange', () => {
	if (document.hidden || !unseen)
		return
	document.title = originalTitle
	unseen = 0
})

useLiveMessages((message) => {
	if (message.type === 'comment')
		markUnseen()
	if (phase.value !== 'ready')
		return
	// 别人改了评论：就地换正文、标「已编辑」（回复由各层楼自己换）
	if (message.type === 'comment-edit') {
		const thread = threads.value.find(item => item.id === message.id)
		if (thread)
			Object.assign(thread, { body: message.body, editedAt: message.editedAt })
		return
	}
	if (message.type === 'comment-delete') {
		const before = threads.value.length
		threads.value = threads.value.filter(thread => thread.id !== message.id)
		total.value -= before - threads.value.length
		return
	}
	if (message.type !== 'comment' || message.rootId || threads.value.some(thread => thread.id === message.comment.id))
		return
	total.value++
	const thread: CommentThread = { ...message.comment, replies: [], fresh: true }
	if (currentSort.value === 'oldest') {
		if (page.value >= totalPages.value)
			threads.value.push(thread)
		return
	}
	const at = currentSort.value === 'pinned' ? threads.value.findIndex(item => !item.pinned) : 0
	threads.value.splice(at < 0 ? threads.value.length : at, 0, thread)
})

function changeSort(value: CommentSort) {
	if (value === currentSort.value)
		return
	sort.value = value
	if (phase.value === 'ready' || phase.value === 'error')
		load()
}

const { stop } = useIntersectionObserver(commentEl, ([entry]) => {
	if (!entry?.isIntersecting || status.value !== 'open')
		return
	stop()
	load()
}, { rootMargin: '400px' })

const TARGET = /^#comments?-([1-9]\d{0,18})$/

function scrollToComment(id: string) {
	const el = document.getElementById(`comment-${id}`)
	if (!el)
		return false
	highlighted.value = id
	el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
	return true
}

/** `#comment-<id>`：先加载评论区，已加载的楼层里有就滚过去；没有就单独取它那层楼，放在最上面 */
async function locate(id: string) {
	stop()
	commentEl.value?.scrollIntoView({ block: 'start' })
	if (phase.value !== 'ready')
		await load()
	if (phase.value !== 'ready')
		return
	await nextTick()
	if (scrollToComment(id))
		return
	try {
		const { thread, targetId } = await api.locate(props.refId, id)
		locatedRoot.value = thread.id
		threads.value = [thread, ...threads.value.filter(item => item.id !== thread.id)]
		await nextTick()
		scrollToComment(targetId)
	}
	catch {
		notice.value = t('comment.commentYoureLooking')
	}
}

// 正文里打开这一段的讨论时评论区还没加载：先加载（讨论弹层用评论区的身份与表单）
const anchorPanel = useAnchorPanel()
watch(anchorPanel, (value) => {
	if (value && phase.value === 'idle' && status.value === 'open') {
		stop()
		load()
	}
})

// 正文高亮处的弹窗里点了某条评论（`#comment-<id>`）：地址的锚点变了就去定位
const route = useRoute()
watch(() => route.hash, (hash) => {
	const target = hash.match(TARGET)?.[1]
	if (target && status.value === 'open')
		locate(target)
})

onMounted(() => {
	if (status.value !== 'open')
		return
	const back = takeLoginReturn('comments')
	if (back?.failed)
		notice.value = t('common.signDidntGo')
	const target = location.hash.match(TARGET)?.[1]
	if (target)
		locate(target)
	else if (back)
		commentEl.value?.scrollIntoView({ block: 'start' })
})
</script>

<template>
<section id="comments" ref="comment" class="z-comment">
	<div class="comment-heading">
		<h3 class="text-creative">
			{{ t('common.comments') }}<span v-if="phase === 'ready' && total" class="comment-count">{{ total }}</span>
		</h3>
		<div v-if="status === 'open'" class="comment-sort" role="group" :aria-label="t('comment.sortComments')">
			<button
				v-for="item in SORTS"
				:key="item.value"
				type="button"
				:aria-pressed="currentSort === item.value"
				:disabled="phase === 'loading'"
				@click="changeSort(item.value)"
			>
				{{ item.label }}
			</button>
		</div>
	</div>

	<p v-if="notice" class="comment-notice" role="status">
		{{ notice }}
	</p>

	<!-- interactive 默认会把气泡移动到 triggerTarget 的父元素上 -->
	<Tooltip
		ref="popover"
		v-bind="popoverBind"
		:append-to="() => commentEl!"
		interactive
		:aria="{ expanded: false }"
		trigger="focusin"
	>
		<template #content>
			<div class="popover-confirm">
				<span
					ref="popover-input"
					class="input"
					contenteditable="plaintext-only"
					spellcheck="false"
					@input="checkUndoable"
					@keydown.enter.prevent="confirmOpen"
					v-text="popoverJumpTo"
				/>

				<button
					v-if="showUndo"
					:aria-label="t('common.restoreOriginal')"
					@click="undo()"
				>
					<Icon name="tabler:arrow-back-up" />
				</button>

				<ZButton
					primary
					:text="t('comment.visit')"
					@click="confirmOpen"
				/>
			</div>
		</template>
	</Tooltip>

	<p v-if="status === 'closed'" class="comment-state">
		{{ t('comment.commentsClosed') }}
	</p>
	<p v-else-if="status === 'unavailable'" class="comment-state">
		{{ t('comment.commentsTemporarilyUnavailable') }}
	</p>
	<p v-else-if="phase === 'error'" class="comment-state">
		{{ t('comment.couldntLoadComments') }}<button type="button" class="comment-retry" @click="load">
			{{ t('common.retry') }}
		</button>
	</p>
	<p v-else-if="phase !== 'ready'" class="comment-state">
		{{ t('comment.loadingComments') }}
	</p>
	<template v-else>
		<CommentForm @submitted="onSubmitted" />

		<p v-if="!threads.length" class="comment-state">
			{{ t('comment.noCommentsYetFirst') }}
		</p>
		<div v-else class="comment-list">
			<CommentThread v-for="thread in threads" :key="thread.id === locatedRoot ? `${thread.id}:located` : thread.id" :thread />
		</div>

		<CommentAnchorPanel :threads @submitted="onSubmitted" />

		<div v-if="page < totalPages" class="comment-more">
			<ZButton :text="loadingMore ? t('common.loading') : moreFailed ? t('comment.couldntLoadClick') : t('comment.moreComments')" :disabled="loadingMore" @click="loadMore" />
		</div>
	</template>
</section>
</template>

<style scoped>
.z-comment {
	margin: 3rem 1rem;
	scroll-margin-top: 4rem;
}

.comment-heading {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5em 1em;
	margin-top: 3rem;

	> h3 {
		font-size: 1.25rem;
	}
}

.comment-sort {
	display: inline-flex;
	gap: 0.2em;
	font-size: 0.85em;

	> button {
		padding: 0.1em 0.6em;
		border-radius: 0.5em;
		color: var(--c-text-3);
		transition: color 0.1s, background-color 0.2s;

		&:hover:not(:disabled) {
			color: var(--c-primary);
		}

		&[aria-pressed="true"] {
			background-color: var(--c-bg-2);
			color: var(--c-text);
		}
	}
}

.comment-notice {
	margin: 1em 0 0;
	padding: 0.5em 0.8em;
	border-radius: 0.5em;
	background-color: var(--c-bg-2);
	font-size: 0.9em;
	color: var(--c-text-2);
}

:deep() > [data-tippy-root] > .tippy-box {
	padding: 0;
}

.popover-confirm {
	display: flex;
	align-items: center;
	overflow-wrap: anywhere;

	> .input {
		min-width: 0;
		padding: 0.3em 0.6em;
		outline: none;
	}

	> button {
		flex-shrink: 0;
		align-self: stretch;
		padding: 0.3em;
		border-radius: 0 0.5em 0.5em 0;
	}
}

.comment-count {
	margin-inline-start: 0.4em;
	font-size: 0.8em;
	color: var(--c-text-3);
}

.comment-state {
	margin: 2em 0;
	text-align: center;
	color: var(--c-text-2);
}

.comment-retry {
	color: var(--c-primary);
}

.comment-list {
	display: grid;
	gap: 1.5em;
	margin: 2em 0;
}

.comment-more {
	text-align: center;
}
</style>
