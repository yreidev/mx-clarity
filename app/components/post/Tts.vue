<script setup lang="ts">
import type { TtsSegment } from '~/types/insights'
import { classifyMxError } from '~/utils/mx/errors'
import { loadTts } from '~/utils/mx/tts'
import { anchorBlockById } from '~/utils/selection-anchor'

/**
 * AI 朗读（core 已经生成好的音频）：点了才取分段，一段接一段放，预加载下一段。
 * 播放条在正文上方：播放 / 暂停、第几段、进度、倍速、停止；正在读的那一块加淡淡的底色并跟着滚，
 * 读者自己一滚就不再跟随（「回到朗读位置」重新跟随）。桌面上播放条滚出视口后右下角有个小播放器。
 * 分段与音频都由浏览器直接从 core 或存储取（和正文图片一样会拿到读者 IP）；付费文章带着读者的 cookie
 */
const props = defineProps<{
	id: string
	/** 朗读版本早于最近的修改 */
	stale?: boolean
}>()

const SPEEDS = [1, 1.25, 1.5, 1.75, 2]
/** 程序滚动之后这么久内的滚动不算读者自己滚的 */
const SCROLL_GUARD = 450

const t = useT()
const segments = ref<TtsSegment[]>()
const index = ref(0)
const state = ref<'idle' | 'loading' | 'playing' | 'paused'>('idle')
const failed = ref(false)
const speed = useLocalStorage('mx-clarity:tts-speed', 1)
const following = ref(true)
const audio = useTemplateRef<HTMLAudioElement>('audio')
const bar = useTemplateRef<HTMLElement>('bar')
let preload: HTMLAudioElement | undefined
let guardUntil = 0

const active = computed(() => state.value === 'playing' || state.value === 'paused')
const current = computed(() => segments.value?.[index.value])
const total = computed(() => segments.value?.length ?? 0)
const speedText = computed(() => `${speed.value}×`)

// 播放条滚出视口、宽屏时显示右下角的小播放器
const barVisible = ref(true)
useIntersectionObserver(bar, ([entry]) => barVisible.value = entry?.isIntersecting ?? true)
const wide = useMediaQuery('(min-width: 1081px)')
const showMini = computed(() => active.value && !barVisible.value && wide.value)

// 段落边栏的「从这一段开始朗读」：分段取回后登记有哪些块
const ttsBlocks = useTtsBlocks()
const core = useCoreClient()

async function load() {
	if (segments.value)
		return segments.value
	// 没有朗读、这一语言没有、付费文章读不了：当作没有；别的错误算失败
	const res = await loadTts(core(), props.id).catch((error) => {
		const failure = classifyMxError(error)
		return failure.kind === 'not-found' || failure.status === 400 || failure.status === 403 ? [] : undefined
	})
	segments.value = res ?? []
	failed.value = !res || !segments.value.length
	ttsBlocks.value = { ids: segments.value.flatMap(segment => segment.blockId ? [segment.blockId] : []), play: playBlock }
	return segments.value
}

/** 从某一块开始放（段落边栏用） */
function playBlock(blockId: string) {
	const at = segments.value?.findIndex(segment => segment.blockId === blockId) ?? -1
	if (at < 0)
		return
	following.value = true
	playAt(at)
}

function playAt(at: number) {
	const segment = segments.value?.[at]
	if (!segment || !audio.value)
		return
	index.value = at
	audio.value.src = segment.url
	audio.value.playbackRate = speed.value
	audio.value.play().catch(() => {
		failed.value = true
		stop()
	})
}

async function toggle() {
	if (state.value === 'playing') {
		audio.value?.pause()
		return
	}
	if (state.value === 'paused') {
		audio.value?.play().catch(() => stop())
		return
	}
	state.value = 'loading'
	const list = await load()
	if (!list.length) {
		state.value = 'idle'
		return
	}
	following.value = true
	playAt(0)
}

function stop() {
	audio.value?.pause()
	audio.value?.removeAttribute('src')
	index.value = 0
	state.value = 'idle'
	following.value = true
}

function cycleSpeed() {
	speed.value = SPEEDS[(SPEEDS.indexOf(speed.value) + 1) % SPEEDS.length] ?? 1
	if (audio.value)
		audio.value.playbackRate = speed.value
}

function onPlay() {
	state.value = 'playing'
	const next = segments.value?.[index.value + 1]
	if (next) {
		preload = new Audio()
		preload.preload = 'auto'
		preload.src = next.url
	}
}

function onPause() {
	if (state.value === 'playing')
		state.value = 'paused'
}

function onEnded() {
	if (index.value + 1 >= total.value)
		stop()
	else
		playAt(index.value + 1)
}

// —— 逐段高亮与跟随 ——
let highlighted: Element | undefined
function blockOf(segment: TtsSegment | undefined) {
	const root = document.querySelector('#main-content article.article')
	return segment?.blockId && root ? anchorBlockById(root, segment.blockId) : undefined
}

function scrollToCurrent() {
	const el = blockOf(current.value)
	if (!el)
		return
	guardUntil = Date.now() + SCROLL_GUARD
	el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

watch([index, active], () => {
	highlighted?.classList.remove('tts-reading')
	highlighted = active.value ? blockOf(current.value) : undefined
	highlighted?.classList.add('tts-reading')
	if (highlighted && following.value && state.value === 'playing')
		scrollToCurrent()
})

/** 读者自己滚动（滚轮、触摸、翻页键）就不再跟随 */
function onUserScroll() {
	if (active.value && Date.now() > guardUntil)
		following.value = false
}
useEventListener('wheel', onUserScroll, { passive: true })
useEventListener('touchmove', onUserScroll, { passive: true })
useEventListener('keydown', (event: KeyboardEvent) => {
	if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(event.key))
		onUserScroll()
})

function locate() {
	following.value = true
	scrollToCurrent()
}

onBeforeUnmount(() => {
	highlighted?.classList.remove('tts-reading')
	preload = undefined
	ttsBlocks.value = { ids: [] }
})
</script>

<template>
<div ref="bar" class="post-tts" role="group" :aria-label="t('post.aiReadAloud')">
	<template v-if="!active">
		<button type="button" class="post-tts-button" :disabled="state === 'loading'" @click="toggle">
			<Icon :name="state === 'loading' ? 'tabler:loader-2' : 'tabler:headphones'" :class="{ spinning: state === 'loading' }" />
			{{ state === 'loading' ? t('common.loading') : t('post.readAloud') }}
		</button>
		<span v-if="failed" class="post-tts-note">{{ t('post.readAloudUnavailable') }}</span>
		<span v-else-if="stale" class="post-tts-note">{{ t('post.audioPredatesLatest') }}</span>
	</template>
	<template v-else>
		<button type="button" class="post-tts-button" :aria-pressed="state === 'playing'" :aria-label="state === 'playing' ? t('post.pause') : t('post.resume')" @click="toggle">
			<Icon :name="state === 'playing' ? 'tabler:player-pause' : 'tabler:player-play'" />
			{{ state === 'playing' ? t('post.pause') : t('post.resume') }}
		</button>
		<span class="post-tts-progress">{{ t('post.segmentOf', { current: index + 1, total }) }}</span>
		<span class="post-tts-meter" aria-hidden="true"><span :style="{ width: `${(index + 1) / total * 100}%` }" /></span>
		<button type="button" class="post-tts-small" :aria-label="t('post.playbackSpeedClick', { speed: speedText })" @click="cycleSpeed">
			{{ speedText }}
		</button>
		<button v-if="!following" type="button" class="post-tts-small" @click="locate">
			<Icon name="tabler:focus-2" /> {{ t('post.backReadingPosition') }}
		</button>
		<button type="button" class="post-tts-small" :aria-label="t('post.stopReadingAloud')" @click="stop">
			<Icon name="tabler:x" />
		</button>
		<p v-if="current?.text" class="post-tts-text" aria-live="polite">
			{{ current.text }}
		</p>
	</template>
	<!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
	<audio ref="audio" preload="none" @play="onPlay" @pause="onPause" @ended="onEnded" />
</div>

<div v-if="showMini" class="post-tts-mini" role="group" :aria-label="t('post.aiReadAloud')">
	<button type="button" :aria-label="state === 'playing' ? t('post.pause') : t('post.resume')" @click="toggle">
		<Icon :name="state === 'playing' ? 'tabler:player-pause' : 'tabler:player-play'" />
	</button>
	<span class="post-tts-progress">{{ index + 1 }} / {{ total }}</span>
	<button type="button" :aria-label="t('post.backReadingPosition')" :title="t('post.backReadingPosition')" @click="locate">
		<Icon name="tabler:focus-2" />
	</button>
	<button type="button" :aria-label="t('post.stopReadingAloud')" :title="t('post.stopReadingAloud')" @click="stop">
		<Icon name="tabler:x" />
	</button>
</div>
</template>

<style lang="scss" scoped>
.post-tts {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4em 0.8em;
	margin: 0.5rem 1.5rem;
	font-size: 0.85em;
	color: var(--c-text-2);
}

.post-tts-button {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	padding: 0.2em 0.7em;
	border: 1px solid var(--c-border);
	border-radius: 1em;
	color: var(--c-text);

	&:hover:not(:disabled), &[aria-pressed="true"] {
		border-color: var(--c-primary);
		color: var(--c-primary);
	}
}

.post-tts-small {
	display: inline-flex;
	align-items: center;
	gap: 0.2em;
	padding: 0.1em 0.4em;
	border-radius: 0.4em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-2);

	&:hover {
		background-color: var(--c-bg-2);
		color: var(--c-primary);
	}
}

.post-tts-progress {
	font-variant-numeric: tabular-nums;
}

.post-tts-meter {
	overflow: hidden;
	width: 5em;
	height: 3px;
	border-radius: 2px;
	background-color: var(--c-border);

	> span {
		display: block;
		height: 100%;
		background-color: var(--c-primary);
		transition: width 0.3s;
	}
}

.post-tts-text {
	flex-basis: 100%;
	margin: 0;
	color: var(--c-text);
}

.spinning {
	animation: tts-spin 1s linear infinite;
}

@keyframes tts-spin {
	to { transform: rotate(360deg); }
}

.post-tts-mini {
	display: flex;
	align-items: center;
	gap: 0.3em;
	position: fixed;
	right: 1rem;
	bottom: max(1rem, env(safe-area-inset-bottom));
	padding: 0.3em 0.5em;
	border: 1px solid var(--c-border);
	border-radius: 2em;
	box-shadow: 0 0.5em 1.5em #0002;
	background-color: var(--c-bg);
	font-size: 0.85em;
	color: var(--c-text-2);
	z-index: 40;

	> button {
		display: inline-flex;
		padding: 0.3em;
		border-radius: 50%;

		&:hover {
			background-color: var(--c-bg-2);
			color: var(--c-primary);
		}
	}
}
</style>
