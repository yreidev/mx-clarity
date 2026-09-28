<script setup lang="ts">
import type { LiveDesk, OwnerStatus } from '~/types/live'
import { loadOwnerStatus } from '~/utils/mx/companion'

/**
 * 侧栏顶部的站长「此刻」（在用的应用、在听的歌）与站长状态。主题配置 `liveDesk.enable`、`ownerStatus.fn` 默认都关，
 * 开了才取；只在浏览器里取（服务端渲染出的页面会被缓存，「此刻」早就过时了）。
 * 「此刻」有实时推送就跟着变，断线重连后重新取一次；到了过期时间自己消失。
 * 应用图标与封面是主题服务器转发的本站地址；播放进度以收到的那一刻为起点每秒往前推（主题下发时已按自己的时间推算好）
 */
const { data: theme } = useMxTheme()
const { reader } = useMxReader()
const t = useT()
const desk = ref<LiveDesk | null>(null)
/** 收到这份「此刻」时浏览器的时间：进度从这里往前推 */
const receivedAt = ref(0)
function setDesk(next: LiveDesk | null) {
	desk.value = next
	receivedAt.value = Date.now()
}
// 站长：配了状态云函数时能在这里设置状态
const canSetStatus = computed(() => reader.value?.reader?.isOwner === true && Boolean(theme.value.ownerStatus.fn))
const status = ref<OwnerStatus | null>(null)
const statusDialog = useTemplateRef<{ open: () => void }>('status-dialog')
// 站长刚改完：直接问一次 core（本站缓存的那份最多晚一分钟）
const core = useCoreClient()
async function reloadStatus() {
	const fn = theme.value.ownerStatus.fn
	status.value = fn ? await loadOwnerStatus(core(), fn) : null
}
const now = ref(Date.now())

const visibleDesk = computed(() => (desk.value?.expiresAt && Date.parse(desk.value.expiresAt) <= now.value ? null : desk.value))
const visibleStatus = computed(() => (status.value?.untilAt && Date.parse(status.value.untilAt) <= now.value ? null : status.value))

const appText = computed(() => {
	const app = visibleDesk.value?.app
	if (!app)
		return ''
	return [app.label ? t('site.using2', { name: app.name, label: app.label }) : t('site.using', { name: app.name }), app.window].filter(Boolean).join(' · ')
})
/** 已播与总长（有时长时）：位置按收到之后过了多久、乘以速率往前推，夹在时长以内 */
const progress = computed(() => {
	const media = visibleDesk.value?.media
	if (!media?.durationMs || media.positionMs === undefined)
		return undefined
	const elapsed = media.playing ? Math.max(0, now.value - receivedAt.value) * (media.rate ?? 1) : 0
	const position = Math.min(media.durationMs, media.positionMs + elapsed)
	return { percent: position / media.durationMs * 100, text: `${clockOf(position)} / ${clockOf(media.durationMs)}` }
})
function clockOf(ms: number) {
	const seconds = Math.floor(ms / 1000)
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const mediaText = computed(() => {
	const media = visibleDesk.value?.media
	if (!media)
		return ''
	const title = [media.title, media.artist].filter(Boolean).join(' — ')
	const playing: Record<NonNullable<LiveDesk['media']>['kind'], string> = {
		music: t('site.listeningTo', { title }),
		podcast: t('site.listeningTo', { title }),
		video: t('site.watching', { title }),
		unknown: t('site.playing', { title }),
	}
	return media.playing ? playing[media.kind] : t('site.paused', { title })
})

/** 映射与图片签名在本站做；`rev` 是实时推送里的版本号，本站缓存的比它旧就回源取新的 */
function fetchDesk(rev?: string) {
	return theme.value.liveDesk.enable ? $fetch<LiveDesk | null>('/api/mx/live-desk', { query: rev ? { rev } : {} }).catch(() => null) : Promise.resolve(null)
}

useLiveMessages((message) => {
	if (message.type === 'live-desk-changed' && theme.value.liveDesk.enable)
		fetchDesk(`${message.epoch}:${message.revision}`).then(setDesk)
	// 断线期间的变化丢了：重新取一次
	else if (message.type === 'reconnected' && theme.value.liveDesk.enable)
		fetchDesk().then(setDesk)
})

// 进度每秒推一次（在放、有时长时）；别的时候半分钟看一次状态有没有到期
useIntervalFn(() => now.value = Date.now(), () => (progress.value && desk.value?.media?.playing ? 1000 : 30_000))

// 「此刻」到了过期时间准时消失
let expiryTimer: ReturnType<typeof setTimeout> | undefined
watch(() => desk.value?.expiresAt, (expiresAt) => {
	clearTimeout(expiryTimer)
	const left = expiresAt ? Date.parse(expiresAt) - Date.now() : Number.NaN
	if (left > 0 && left < 86_400_000)
		expiryTimer = setTimeout(() => now.value = Date.now(), left + 50)
})
onBeforeUnmount(() => clearTimeout(expiryTimer))

onMounted(async () => {
	const [nextDesk, nextStatus] = await Promise.all([
		fetchDesk(),
		theme.value.ownerStatus.fn ? $fetch<OwnerStatus | null>('/api/mx/owner-status').catch(() => null) : null,
	])
	// 推送可能已经先到了，以推送为准
	if (!desk.value)
		setDesk(nextDesk)
	status.value = nextStatus
})
</script>

<template>
<section v-if="visibleStatus || appText || mediaText || canSetStatus" class="live-desk" :aria-label="t('site.ownersNow')">
	<p v-if="visibleStatus || canSetStatus" class="live-desk-line" :title="visibleStatus?.desc">
		<template v-if="visibleStatus">
			<span v-if="visibleStatus.emoji" aria-hidden="true">{{ visibleStatus.emoji }}</span>
			<span class="live-desk-text">{{ visibleStatus.desc }}</span>
		</template>
		<span v-else class="live-desk-text">{{ t('site.noStatusSet') }}</span>
		<button v-if="canSetStatus" type="button" class="live-desk-edit" :aria-label="t('site.setStatus')" :title="t('site.setStatus')" @click="statusDialog?.open()">
			<Icon name="tabler:mood-edit" />
		</button>
	</p>
	<p v-if="appText" class="live-desk-line" :title="appText">
		<img v-if="visibleDesk?.app?.icon" class="live-desk-icon" :src="visibleDesk.app.icon" alt="" loading="lazy">
		<Icon v-else name="tabler:app-window" />
		<span class="live-desk-text">{{ appText }}</span>
	</p>
	<div v-if="mediaText" class="live-desk-media">
		<img v-if="visibleDesk?.media?.artwork" class="live-desk-artwork" :src="visibleDesk.media.artwork" alt="" loading="lazy">
		<Icon v-else class="live-desk-artwork" :name="visibleDesk?.media?.kind === 'video' ? 'tabler:movie' : 'tabler:music'" />
		<div class="live-desk-media-main">
			<p class="live-desk-line" :title="mediaText">
				<a v-if="visibleDesk?.media?.link" class="live-desk-text" :href="visibleDesk.media.link" target="_blank" rel="noopener noreferrer">{{ mediaText }}</a>
				<span v-else class="live-desk-text">{{ mediaText }}</span>
			</p>
			<p v-if="progress" class="live-desk-progress">
				<span class="live-desk-meter" aria-hidden="true"><span :style="{ width: `${progress.percent}%` }" /></span>
				<span>{{ progress.text }}</span>
			</p>
		</div>
	</div>
	<BlogOwnerStatusDialog v-if="canSetStatus" ref="status-dialog" :current="visibleStatus" @saved="reloadStatus" />
</section>
</template>

<style scoped>
.live-desk {
	display: grid;
	gap: 0.2em;
	margin: 0 1rem 0.5rem;
	padding: 0.4em 0.7em;
	border-radius: 0.6em;
	background-color: var(--c-bg-2);
	font-size: 0.8em;
	color: var(--c-text-2);
}

.live-desk-line {
	display: flex;
	align-items: center;
	gap: 0.4em;
	min-width: 0;
	margin: 0;

	> .iconify {
		flex-shrink: 0;
	}
}

.live-desk-icon {
	flex-shrink: 0;
	width: 1em;
	height: 1em;
	border-radius: 0.2em;
	object-fit: cover;
}

.live-desk-media {
	display: flex;
	align-items: center;
	gap: 0.5em;
	min-width: 0;

	> .live-desk-artwork {
		flex-shrink: 0;
		width: 2.2em;
		height: 2.2em;
		border-radius: 0.4em;
		object-fit: cover;
	}

	a:hover {
		color: var(--c-primary);
	}
}

.live-desk-media-main {
	display: grid;
	flex: 1;
	gap: 0.15em;
	min-width: 0;
}

.live-desk-progress {
	display: flex;
	align-items: center;
	gap: 0.5em;
	margin: 0;
	font-size: 0.9em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
}

.live-desk-meter {
	flex: 1;
	overflow: hidden;
	height: 2px;
	border-radius: 1px;
	background-color: var(--c-border);

	> span {
		display: block;
		height: 100%;
		background-color: var(--c-primary);
		transition: width 1s linear;

		@media (prefers-reduced-motion: reduce) {
			transition: none;
		}
	}
}

.live-desk-edit {
	display: inline-flex;
	flex-shrink: 0;
	margin-inline-start: auto;
	padding: 0.1em;
	border-radius: 0.3em;
	color: var(--c-text-3);

	&:hover {
		background-color: var(--c-bg);
		color: var(--c-primary);
	}
}

.live-desk-text {
	overflow: hidden;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
}
</style>
