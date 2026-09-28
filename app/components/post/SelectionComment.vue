<script setup lang="ts">
import type { CommentAnchorDraft } from '~/types/comment'
import { anchorBlockOf, anchorFromRange } from '~/utils/selection-anchor'

/**
 * 选中正文里的文字后，选区上方（贴近视口顶时改到下方；手机上在下方 24px）浮出一条小工具条：
 * 「复制」，以及「评论这段」（起止在同一块、200 字内、块有 id：划词评论）或「引用评论」（别的情况：把 `> 选中的文字` 预填进评论框，不带锚点）。
 * 评论关闭的站点不出评论的按钮
 */
const t = useT()
const { data: site } = useMxSite()
const anchor = useCommentAnchor()
const quoteDraft = useCommentQuote()
const commentsOpen = computed(() => site.value.source !== 'static' && site.value.comments.enabled)

const pending = ref<{ draft?: CommentAnchorDraft, text: string, x: number, y: number }>()
const copied = ref(false)

function update() {
	const selection = getSelection()
	const root = document.querySelector('#main-content article.article')
	if (!selection || selection.isCollapsed || !selection.rangeCount || !root) {
		pending.value = undefined
		return
	}
	const range = selection.getRangeAt(0)
	if (!root.contains(range.commonAncestorContainer)) {
		pending.value = undefined
		return
	}
	const text = selection.toString().replace(/\s+/g, ' ').trim()
	if (!text) {
		pending.value = undefined
		return
	}
	const block = anchorBlockOf(range, root)
	const draft = block ? anchorFromRange(block, range) : undefined
	const rect = range.getBoundingClientRect()
	const coarse = matchMedia('(pointer: coarse)').matches
	const above = rect.top - 44
	copied.value = false
	pending.value = {
		draft,
		text,
		x: Math.min(Math.max(rect.left + rect.width / 2, 90), innerWidth - 90),
		y: Math.max(8, coarse || above < 64 ? Math.min(rect.bottom + (coarse ? 24 : 8), innerHeight - 48) : above),
	}
}

useEventListener(document, 'selectionchange', useDebounceFn(update, 250))

// 手机上压掉 iOS 的系统长按菜单，免得和浮条重叠（浮条里有「复制」）
onMounted(() => document.querySelector('#main-content article.article')?.classList.add('selection-commentable'))
onBeforeUnmount(() => document.querySelector('#main-content article.article')?.classList.remove('selection-commentable'))
useEventListener('scroll', () => pending.value = undefined, { passive: true })

function scrollToComments() {
	document.getElementById('comments')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

async function copy() {
	if (!pending.value)
		return
	try {
		await navigator.clipboard.writeText(getSelection()?.toString() ?? pending.value.text)
		copied.value = true
	}
	catch {}
}

function comment() {
	if (!pending.value)
		return
	if (pending.value.draft)
		anchor.value = pending.value.draft
	else
		quoteDraft.value = pending.value.text.slice(0, 200)
	pending.value = undefined
	getSelection()?.removeAllRanges()
	scrollToComments()
}
</script>

<template>
<div
	v-if="pending"
	class="selection-bar"
	role="toolbar"
	:aria-label="t('comment.selectedText')"
	:style="{ left: `${pending.x}px`, top: `${pending.y}px` }"
	@mousedown.prevent
>
	<button type="button" @click="copy">
		<Icon :name="copied ? 'tabler:check' : 'tabler:copy'" /> {{ copied ? t('common.copied') : t('common.copy') }}
	</button>
	<button v-if="commentsOpen" type="button" @click="comment">
		<Icon name="tabler:message-circle-plus" /> {{ pending.draft ? t('comment.commentOnThis') : t('comment.quoteComment') }}
	</button>
</div>
</template>

<style scoped>
.selection-bar {
	display: inline-flex;
	gap: 0.1em;
	position: fixed;
	padding: 0.2em;
	border: 1px solid var(--c-border);
	border-radius: 2em;
	box-shadow: 0 0.3em 1em #0002;
	background-color: var(--c-bg);
	font-size: 0.85em;
	transform: translateX(-50%);
	/* 在右下角的浮动按钮之上（手机上浮条贴着选区下方，可能正好落在按钮那里） */
	z-index: calc(var(--z-index-popover) + 1);

	> button {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		padding: 0.25em 0.7em;
		border-radius: 2em;
		color: var(--c-text-2);

		&:hover {
			background-color: var(--c-primary-soft);
			color: var(--c-primary);
		}
	}
}
</style>
