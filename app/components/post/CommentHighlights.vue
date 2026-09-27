<script setup lang="ts">
import type { CommentAnchorDraft, CommentHighlight } from '~/types/comment'
import { anchorBlockById, anchorFromRange, quoteRangeIn } from '~/utils/selection-anchor'

/**
 * 正文里被划词评论过的文字：用 CSS Custom Highlight API 画下划线（不改 DOM）。
 * 点下划线处打开这一段的讨论（评论区渲染的弹层）。鼠标停在下划线上：光标变成手形、这一段加悬停底色、
 * 评论区里对应的评论标出来，停一会儿在旁边弹出只读的预览（谁说了什么，点划线看全部、回复）；
 * 停在评论的「引用」上时这里也给那一段加悬停底色。取回的列表也给段落边栏用（`useAnchoredComments`）。
 * 浏览器不支持时什么都不画（评论上的「引用」照样能跳回正文）。有人发了新的顶层评论就重取一次
 */
const props = defineProps<{
	refId: string
}>()
const commentApi = useCommentApi()
const NAME = 'mx-comment'
const HOVER = 'mx-comment-hover'
const revision = useState('mx-comment-highlights', () => 0)
const anchored = useAnchoredComments()
const panel = useAnchorPanel()
const hovered = useHoveredAnchor()
const painted = shallowRef<{ range: Range, draft: CommentAnchorDraft, items: CommentHighlight[] }[]>([])
const t = useT()

function registry() {
	const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights
	const HighlightClass = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
	return highlights && HighlightClass ? { highlights, HighlightClass } : undefined
}

const rootOf = () => document.querySelector('#main-content article.article')

async function load() {
	const root = rootOf()
	if (!root)
		return
	const items = await commentApi.highlights(props.refId).catch(() => [])
	anchored.value = items
	const byRange = new Map<string, { range: Range, draft: CommentAnchorDraft, items: CommentHighlight[] }>()
	for (const item of items) {
		if (item.mode === 'block')
			continue
		const block = anchorBlockById(root, item.blockId)
		const range = block && quoteRangeIn(block, item.quote, item.index)
		if (!range || !block)
			continue
		const key = `${item.blockId}:${item.index}:${item.quote}`
		const entry = byRange.get(key) ?? { range, draft: anchorFromRange(block, range) ?? { blockId: item.blockId, quote: item.quote, prefix: '', suffix: '' }, items: [] }
		entry.items.push(item)
		byRange.set(key, entry)
	}
	painted.value = [...byRange.values()]
	const api = registry()
	if (!api)
		return
	if (painted.value.length)
		api.highlights.set(NAME, new api.HighlightClass(...painted.value.map(entry => entry.range)))
	else
		api.highlights.delete(NAME)
}

const reload = useDebounceFn(load, 1500)
useLiveMessages((message) => {
	if (message.type === 'comment' && !message.rootId)
		reload()
})
watch(revision, () => load())

/** 点击处的光标位置（Firefox 与新版 Chrome 有 caretPositionFromPoint，Safari 只有 caretRangeFromPoint） */
function caretPointOf(x: number, y: number) {
	const caret = (document as { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node, offset: number } | null }).caretPositionFromPoint?.(x, y)
	if (caret)
		return { node: caret.offsetNode, offset: caret.offset }
	const range = document.caretRangeFromPoint?.(x, y)
	return range ? { node: range.startContainer, offset: range.startOffset } : undefined
}

function hitAt(x: number, y: number) {
	const point = painted.value.length ? caretPointOf(x, y) : undefined
	return point ? painted.value.find(entry => entry.range.isPointInRange(point.node, point.offset)) : undefined
}

function onClick(event: MouseEvent) {
	if (getSelection()?.isCollapsed === false)
		return
	const hit = hitAt(event.clientX, event.clientY)
	if (hit) {
		closePreview()
		panel.value = { draft: hit.draft, ids: hit.items.map(item => item.id), x: event.clientX, y: event.clientY }
	}
}

// 悬停预览：停在下划线上 0.3 秒后弹出；移开 0.2 秒后收起，其间鼠标挪进预览里就不收
const PREVIEW_SHOWN = 3
const PREVIEW_WIDTH = 320
const preview = shallowRef<{ key: string, quote: string, items: CommentHighlight[], style: Record<string, string> }>()
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined

/** 鼠标挪进了预览：不收 */
function keepPreview() {
	clearTimeout(closeTimer)
}

function closePreview() {
	clearTimeout(openTimer)
	clearTimeout(closeTimer)
	preview.value = undefined
}

/** 下划线可能跨行：取鼠标所在的那一行，贴着它的下方弹出；下方放不下就放上方 */
function previewStyleOf(range: Range, x: number, y: number): Record<string, string> {
	const rects = [...range.getClientRects()]
	const rect = rects.find(item => y >= item.top && y <= item.bottom && x >= item.left - 2 && x <= item.right + 2) ?? rects[0] ?? range.getBoundingClientRect()
	const width = Math.min(PREVIEW_WIDTH, innerWidth - 24)
	const left = `${Math.min(Math.max(12, rect.left), innerWidth - width - 12)}px`
	return rect.bottom + 260 > innerHeight
		? { left, bottom: `${innerHeight - rect.top + 6}px` }
		: { left, top: `${rect.bottom + 6}px` }
}

function schedulePreview(hit: ReturnType<typeof hitAt>, event: PointerEvent) {
	const key = hit && `${hit.draft.blockId}:${hit.draft.quote}`
	if (key && key === preview.value?.key) {
		clearTimeout(closeTimer)
		return
	}
	clearTimeout(openTimer)
	if (!hit || !key) {
		clearTimeout(closeTimer)
		closeTimer = setTimeout(() => preview.value = undefined, 200)
		return
	}
	const { clientX, clientY } = event
	openTimer = setTimeout(() => {
		if (panel.value)
			return
		clearTimeout(closeTimer)
		preview.value = { key, quote: hit.draft.quote, items: hit.items, style: previewStyleOf(hit.range, clientX, clientY) }
	}, 300)
}

// 悬停联动：正文 → 评论区；手形光标；悬停预览只给鼠标（触屏点一下直接开讨论），按着键在选字时不弹
const throttledMove = useThrottleFn((event: PointerEvent) => {
	const hit = hitAt(event.clientX, event.clientY)
	const next = hit ? { blockId: hit.draft.blockId, quote: hit.draft.quote, ids: hit.items.map(item => item.id) } : undefined
	if (next?.ids.join() !== hovered.value?.ids.join())
		hovered.value = next
	const root = rootOf() as HTMLElement | null
	if (root)
		root.style.cursor = hit ? 'pointer' : ''
	if (event.pointerType === 'mouse' && event.buttons === 0)
		schedulePreview(hit, event)
}, 100)
function onMove(event: PointerEvent) {
	throttledMove(event)
}
function onLeave() {
	hovered.value = undefined
	clearTimeout(openTimer)
	clearTimeout(closeTimer)
	closeTimer = setTimeout(() => preview.value = undefined, 200)
}

onKeyStroke('Escape', closePreview)
useEventListener(window, 'scroll', closePreview, { passive: true })
watch(panel, (value) => {
	if (value)
		closePreview()
})

// 悬停联动：评论区 → 正文（给那一段加一层悬停底色）
watch(hovered, (value) => {
	const api = registry()
	if (!api)
		return
	const entry = value?.quote ? painted.value.find(item => item.draft.blockId === value.blockId && item.draft.quote === value.quote) : undefined
	if (entry)
		api.highlights.set(HOVER, new api.HighlightClass(entry.range))
	else
		api.highlights.delete(HOVER)
})

onMounted(() => {
	load()
	const root = rootOf()
	root?.addEventListener('click', onClick as EventListener)
	root?.addEventListener('pointermove', onMove as EventListener)
	root?.addEventListener('pointerleave', onLeave)
})
onBeforeUnmount(() => {
	const root = rootOf()
	root?.removeEventListener('click', onClick as EventListener)
	root?.removeEventListener('pointermove', onMove as EventListener)
	root?.removeEventListener('pointerleave', onLeave)
	closePreview()
	const api = registry()
	api?.highlights.delete(NAME)
	api?.highlights.delete(HOVER)
	anchored.value = []
	panel.value = undefined
})
</script>

<template>
<Teleport to="body">
	<div
		v-if="preview"
		class="anchor-preview"
		role="tooltip"
		:style="preview.style"
		@pointerenter="keepPreview"
		@pointerleave="onLeave"
	>
		<blockquote class="anchor-preview-quote">
			{{ preview.quote }}
		</blockquote>
		<ul class="anchor-preview-list">
			<li v-for="item in preview.items.slice(0, PREVIEW_SHOWN)" :key="item.id">
				<div class="anchor-preview-head">
					<img v-if="item.avatar" :src="item.avatar" alt="" loading="lazy" referrerpolicy="no-referrer" class="anchor-preview-avatar">
					<Icon v-else name="tabler:user-circle" class="anchor-preview-avatar" />
					<b class="anchor-preview-name">{{ item.author }}</b>
					<UtilDate v-if="item.date" :date="item.date" relative class="anchor-preview-time" />
				</div>
				<p class="anchor-preview-text">
					{{ item.excerpt }}
				</p>
				<span v-if="item.replyCount" class="anchor-preview-replies">{{ t('comment.replies', { n: item.replyCount }) }}</span>
			</li>
		</ul>
		<footer class="anchor-preview-foot">
			<span v-if="preview.items.length > PREVIEW_SHOWN">{{ t('comment.previewMore', { n: preview.items.length - PREVIEW_SHOWN }) }}</span>
			<span>{{ t('comment.previewHint') }}</span>
		</footer>
	</div>
</Teleport>
</template>

<style lang="scss" scoped>
// 正文往里缩一个头像加间距，与昵称对齐
.anchor-preview {
	--avatar: 20px;
	--avatar-gap: 0.5em;

	display: grid;
	gap: 0.7em;
	position: fixed;
	width: min(320px, calc(100vw - 24px));
	padding: 0.8em 0.9em 0.7em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	box-shadow: var(--box-shadow-3);
	background-color: var(--c-bg);
	font-size: 0.85em;
	color: var(--c-text-1);
	z-index: var(--z-index-popover);
}

.anchor-preview-quote {
	display: -webkit-box;
	overflow: hidden;
	overflow-wrap: anywhere;
	margin: 0;
	padding-inline-start: 0.7em;
	border-inline-start: 2px solid var(--c-primary);
	font-style: italic;
	-webkit-line-clamp: 2;
	color: var(--c-text-2);
	-webkit-box-orient: vertical;
}

.anchor-preview-list {
	display: grid;
	gap: 0.7em;
	margin: 0;
	padding: 0;
	list-style: none;
}

.anchor-preview-head {
	display: flex;
	align-items: center;
	gap: var(--avatar-gap);
	min-width: 0;
}

.anchor-preview-avatar {
	flex-shrink: 0;
	width: var(--avatar);
	height: var(--avatar);
	border-radius: 50%;
	color: var(--c-text-3);
	object-fit: cover;
}

.anchor-preview-name {
	overflow: hidden;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.anchor-preview-time {
	flex-shrink: 0;
	margin-inline-start: auto;
	font-size: 0.9em;
	color: var(--c-text-3);
}

.anchor-preview-text {
	display: -webkit-box;
	overflow: hidden;
	overflow-wrap: anywhere;
	margin: 0.2em 0 0;
	padding-inline-start: calc(var(--avatar) + var(--avatar-gap));
	-webkit-line-clamp: 3;
	line-height: 1.6;
	-webkit-box-orient: vertical;
}

.anchor-preview-replies {
	display: block;
	padding-inline-start: calc(var(--avatar) + var(--avatar-gap));
	font-size: 0.9em;
	color: var(--c-text-3);
}

.anchor-preview-foot {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 0.3em 1em;
	padding-top: 0.5em;
	border-top: 1px solid var(--c-border);
	font-size: 0.9em;
	color: var(--c-text-3);
}
</style>
