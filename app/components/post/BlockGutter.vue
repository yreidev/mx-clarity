<script setup lang="ts">
import { anchorBlockById, blockTextOf } from '~/utils/selection-anchor'

/**
 * 段落边栏（桌面 ≥ 1080px）：正文右侧留出 2rem，鼠标移到一块（段落、标题、引用、列表）时那一块旁边出现
 * 「评论这一段」（段落评论）与「朗读这一段」（朗读分段已取回、这一块有分段时）；有评论的块常驻一个小计数，点了打开这一段的讨论。
 * 按视口坐标定位（滚动、缩放时重新量），不往正文里插元素
 */
const wide = useMediaQuery('(min-width: 1081px)')
const { data: site } = useMxSite()
const commentsOpen = computed(() => site.value.source !== 'static' && site.value.comments.enabled)
const anchored = useAnchoredComments()
const panel = useAnchorPanel()
const tts = useTtsBlocks()
const t = useT()

const root = shallowRef<HTMLElement | null>(null)
const left = ref(0)
const hovered = ref<{ blockId: string, top: number }>()
const marks = ref<{ blockId: string, top: number, count: number }[]>([])

const counts = computed(() => {
	const map = new Map<string, number>()
	for (const item of anchored.value)
		map.set(item.blockId, (map.get(item.blockId) ?? 0) + 1)
	return map
})

function measure() {
	const el = root.value
	if (!el)
		return
	left.value = el.getBoundingClientRect().right - 28
	marks.value = [...counts.value].flatMap(([blockId, count]) => {
		const block = anchorBlockById(el, blockId)
		return block ? [{ blockId, top: block.getBoundingClientRect().top, count }] : []
	})
	if (hovered.value) {
		const block = anchorBlockById(el, hovered.value.blockId)
		hovered.value = block ? { blockId: hovered.value.blockId, top: block.getBoundingClientRect().top } : undefined
	}
}

let frame = 0
function schedule() {
	cancelAnimationFrame(frame)
	frame = requestAnimationFrame(measure)
}
useEventListener('scroll', schedule, { passive: true })
useEventListener('resize', schedule, { passive: true })
watch(counts, schedule)

let leaveTimer: ReturnType<typeof setTimeout> | undefined
function onMove(event: MouseEvent) {
	const block = (event.target as Element | null)?.closest?.('[data-block-id]')
	if (!block || !root.value?.contains(block))
		return
	clearTimeout(leaveTimer)
	const blockId = block.getAttribute('data-block-id')!
	if (hovered.value?.blockId !== blockId)
		hovered.value = { blockId, top: block.getBoundingClientRect().top }
}
/** 鼠标离开正文后稍等一下再收起：要能挪到边栏的按钮上 */
function onLeave() {
	clearTimeout(leaveTimer)
	leaveTimer = setTimeout(() => hovered.value = undefined, 400)
}
function keep() {
	clearTimeout(leaveTimer)
}

function openBlock(blockId: string, event: MouseEvent) {
	const block = root.value && anchorBlockById(root.value, blockId)
	const text = block ? blockTextOf(block).text.replace(/\s+/g, ' ').trim() : ''
	panel.value = {
		draft: { blockId, mode: 'block', quote: '', prefix: '', suffix: '', excerpt: text.length > 40 ? `${text.slice(0, 40)}…` : text },
		ids: anchored.value.filter(item => item.blockId === blockId).map(item => item.id),
		x: event.clientX,
		y: event.clientY,
	}
}

onMounted(() => {
	const el = document.querySelector<HTMLElement>('#main-content article.article')
	if (!el?.querySelector('[data-block-id]'))
		return
	root.value = el
	el.classList.add('has-block-gutter')
	el.addEventListener('mousemove', onMove)
	el.addEventListener('mouseleave', onLeave)
	nextTick(measure)
})
onBeforeUnmount(() => {
	cancelAnimationFrame(frame)
	clearTimeout(leaveTimer)
	root.value?.classList.remove('has-block-gutter')
	root.value?.removeEventListener('mousemove', onMove)
	root.value?.removeEventListener('mouseleave', onLeave)
})
</script>

<template>
<div v-if="wide && root" class="block-gutter" :style="{ left: `${left}px` }" @mouseenter="keep" @mouseleave="onLeave">
	<button
		v-for="mark in marks"
		v-show="mark.blockId !== hovered?.blockId"
		:key="mark.blockId"
		type="button"
		class="block-gutter-count"
		:style="{ top: `${mark.top}px` }"
		:aria-label="t('comment.commentsParagraph', { n: mark.count })"
		@click="openBlock(mark.blockId, $event)"
	>
		{{ mark.count }}
	</button>
	<div v-if="hovered" class="block-gutter-actions" :style="{ top: `${hovered.top}px` }">
		<button v-if="commentsOpen" type="button" :aria-label="counts.get(hovered.blockId) ? t('comment.commentsParagraph', { n: counts.get(hovered.blockId)! }) : t('comment.commentParagraph')" :title="counts.get(hovered.blockId) ? t('comment.discussionParagraph') : t('comment.commentParagraph')" @click="openBlock(hovered.blockId, $event)">
			<Icon name="tabler:message-circle" />
			<span v-if="counts.get(hovered.blockId)" class="block-gutter-badge">{{ counts.get(hovered.blockId) }}</span>
		</button>
		<button v-if="tts.play && tts.ids.includes(hovered.blockId)" type="button" :aria-label="t('comment.readAloudParagraph')" :title="t('comment.readAloudParagraph')" @click="tts.play?.(hovered.blockId)">
			<Icon name="tabler:volume" />
		</button>
	</div>
</div>
</template>

<style lang="scss" scoped>
.block-gutter {
	position: fixed;
	top: 0;
	width: 1.6rem;
	height: 0;
	z-index: 20;

	button {
		display: grid;
		place-items: center;
		position: relative;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 0.5em;
		color: var(--c-text-3);

		&:hover {
			background-color: var(--c-bg-2);
			color: var(--c-primary);
		}
	}
}

.block-gutter .block-gutter-count {
	position: absolute;
	font-size: 0.75rem;
	font-variant-numeric: tabular-nums;
	color: var(--c-primary);
}

.block-gutter-actions {
	display: grid;
	gap: 0.1em;
	position: absolute;
}

.block-gutter-badge {
	position: absolute;
	top: -0.2em;
	right: -0.2em;
	min-width: 1.1em;
	padding: 0 0.2em;
	border-radius: 0.6em;
	background-color: var(--c-primary);
	font-size: 0.65rem;
	line-height: 1.1em;
	color: #FFF;
}
</style>
