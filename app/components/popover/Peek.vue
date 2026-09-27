<script setup lang="ts">
import type { MDCNode, MDCRoot } from '@nuxtjs/mdc'
import type { PeekTarget } from '~~/shared/utils/peek'
import type { ArticleDetail } from '~/types/article'
import type { NoteDetail } from '~/types/note'

/**
 * 站内链接预览：宽屏、有指针的设备上，正文里（`.article`）与标了 `data-peek` 的地方（相关文章、时间线、新发布提示）
 * 指向文章、日记的普通左键点击改成弹窗读全文。首页列表、归档、侧栏、上一篇 / 下一篇这些导航链接照常跳转。
 * 打开时地址上加 `?peek-to=<目标>`（`history.replaceState`，不进历史记录），关闭时去掉：分享出去能直接打开那一篇。
 * 按住修饰键、新标签页、下载、锚点、当前这篇照常。弹窗是原生 <dialog>（Esc、焦点、背景惰性），
 * 关闭后焦点回到链接。内容取本站的详情接口，只存在这个页面的内存里；不挂评论、目录、「正在阅读」，不计阅读。
 * 付费文章锁定时只有预览，加密与定时公开的日记只给说明与原页链接
 */
type Loaded
	= | { kind: 'body', title: string, date?: string, path: string, body: MDCRoot, locked?: boolean }
		| { kind: 'notice', title: string, path: string, text: string, failed?: true }

const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const state = ref<Loaded>()
const loading = ref(false)
const route = useRoute()
const { data: site } = useMxSite()
const { reader } = useMxReader()
const timeZone = useSiteTimeZone()
const t = useT()
const locale = useUiLocale()
let trigger: HTMLElement | undefined

// 最多记 20 条；登录状态变了就清掉（付费文章的内容因人而异）
const cache = new Map<string, Promise<Loaded>>()
watch(() => readerKeyOf(reader.value), () => cache.clear())

/** 弹窗里的标题、脚注 id 加前缀，免得和底下那页重复（点锚点会滚动到底下的页面） */
function prefixIds(nodes: MDCNode[] = []): MDCNode[] {
	return nodes.map((node) => {
		if (node.type !== 'element')
			return node
		const props = { ...node.props }
		if (typeof props.id === 'string')
			props.id = `peek-${props.id}`
		if (typeof props.href === 'string' && props.href.startsWith('#'))
			props.href = `#peek-${props.href.slice(1)}`
		return { ...node, props, children: prefixIds(node.children) }
	})
}

async function load(target: PeekTarget): Promise<Loaded> {
	try {
		if (target.kind === 'post') {
			const detail = await $fetch<ArticleDetail>(`/api/mx/posts/${encodeURIComponent(target.category)}/${encodeURIComponent(target.slug)}`)
			return { kind: 'body', title: detail.article.title ?? '', date: detail.article.date, path: detail.article.path, body: { ...detail.body, children: prefixIds(detail.body.children) }, locked: detail.paywall?.locked }
		}
		const detail = await $fetch<NoteDetail>(`/api/mx/notes/${target.nid}`)
		if (detail.locked)
			return { kind: 'notice', title: t('common.passwordProtectedDiary'), path: target.path, text: t('site.diaryEntryPassword') }
		if ('scheduled' in detail)
			return { kind: 'notice', title: t('common.scheduledDiaryEntry'), path: target.path, text: t('site.diaryEntryWill', { time: toZonedLocaleString(detail.publicAt, timeZone.value, 'full', locale.value) }) }
		return { kind: 'body', title: detail.note.title, date: detail.note.date, path: detail.note.path, body: { ...detail.body, children: prefixIds(detail.body.children) } }
	}
	catch {
		return { kind: 'notice', title: t('common.couldntLoadRight'), path: target.path, text: t('site.previewCouldntLoaded'), failed: true }
	}
}

async function open(target: PeekTarget, from: HTMLElement) {
	trigger = from
	state.value = undefined
	loading.value = true
	document.documentElement.classList.add('peek-open')
	dialog.value?.showModal()
	history.replaceState(history.state, '', withPeekTo(location.href, target.path))
	let request = cache.get(target.path)
	if (!request) {
		request = load(target)
		cache.set(target.path, request)
		if (cache.size > 20)
			cache.delete(cache.keys().next().value!)
	}
	const result = await request
	// 没取到的不留：一次网络抖动不该让这个链接之后一直显示「加载不出来」
	if (result.kind === 'notice' && result.failed && cache.get(target.path) === request)
		cache.delete(target.path)
	// 等的时候读者已经关掉了
	if (!dialog.value?.open)
		return
	state.value = result
	loading.value = false
	nextTick(() => dialog.value?.querySelector<HTMLElement>('.peek-title')?.focus())
}

function close() {
	dialog.value?.close()
}

function onClosed() {
	document.documentElement.classList.remove('peek-open')
	if (new URL(location.href).searchParams.has(PEEK_PARAM))
		history.replaceState(history.state, '', withPeekTo(location.href, undefined))
	state.value = undefined
	loading.value = false
	trigger?.focus()
	trigger = undefined
}

// 弹窗里点了站内链接会跳转：跳过去就关掉
watch(() => route.fullPath, close)

const WIDE = '(min-width: 1025px) and (hover: hover) and (pointer: fine)'

function onClick(event: MouseEvent) {
	if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
		return
	if (!matchMedia(WIDE).matches || !(event.target instanceof Element))
		return
	const anchor = event.target.closest('a[href]')
	if (!(anchor instanceof HTMLAnchorElement) || !anchor.closest('.article, [data-peek]') || anchor.closest('dialog') || anchor.hasAttribute('download') || anchor.target === '_blank')
		return
	const origins = [location.origin]
	try {
		if (site.value.webUrl)
			origins.push(new URL(site.value.webUrl).origin)
	}
	catch {}
	const target = peekTargetOf(anchor.getAttribute('href'), location.href, origins)
	if (!target)
		return
	// 捕获阶段拦下：NuxtLink 看到 defaultPrevented 就不跳了
	event.preventDefault()
	event.stopPropagation()
	open(target, anchor)
}

onMounted(() => {
	document.getElementById('main-content')?.addEventListener('click', onClick, { capture: true })
})
onBeforeUnmount(() => {
	document.getElementById('main-content')?.removeEventListener('click', onClick, { capture: true })
	document.documentElement.classList.remove('peek-open')
})
</script>

<template>
<dialog
	ref="dialog"
	class="peek"
	aria-labelledby="peek-title"
	:aria-busy="loading || undefined"
	@close="onClosed"
	@click.self="close"
>
	<div class="peek-panel">
		<header class="peek-header">
			<h2 id="peek-title" class="peek-title" tabindex="-1">
				{{ state?.title || t('common.loading') }}
			</h2>
			<p v-if="state?.kind === 'body' && state.date" class="peek-date">
				{{ toZonedLocaleString(state.date, timeZone, 'date', locale) }}
			</p>
			<div class="peek-actions">
				<NuxtLink v-if="state" :to="state.path" class="peek-open">
					<Icon name="tabler:arrows-maximize" /> {{ t('site.openOriginalPage') }}
				</NuxtLink>
				<button type="button" class="peek-close" :aria-label="t('site.closePreview')" @click="close">
					<Icon name="tabler:x" />
				</button>
			</div>
		</header>
		<div class="peek-body">
			<p v-if="loading" class="peek-notice" role="status">
				{{ t('common.loading') }}
			</p>
			<p v-else-if="state?.kind === 'notice'" class="peek-notice">
				{{ state.text }}
			</p>
			<template v-else-if="state?.kind === 'body'">
				<MxRenderer :body="state.body" class="article" />
				<p v-if="state.locked" class="peek-notice">
					{{ t('site.previewMembersOnly') }}<NuxtLink :to="state.path">
						{{ t('site.openOriginalPage') }}
					</NuxtLink>{{ t('site.readWholePost') }}
				</p>
			</template>
		</div>
	</div>
</dialog>
</template>

<style lang="scss" scoped>
.peek {
	width: min(56rem, 92vw);
	height: min(86vh, 60rem);
	max-width: none;
	max-height: none;
	padding: 0;
	border: 1px solid var(--c-border);
	border-radius: 1em;
	box-shadow: 0 1em 3em #0003;
	background-color: var(--c-bg);
	color: var(--c-text);

	&[open] {
		animation: peek-in 0.18s ease-out;
	}

	&::backdrop {
		background-color: #0006;
	}

	@media (prefers-reduced-motion: reduce) {
		&[open] {
			animation: none;
		}
	}
}

@keyframes peek-in {
	from {
		opacity: 0;
		transform: translateY(0.5em) scale(0.98);
	}
}

.peek-panel {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.peek-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3em 1em;
	padding: 0.8em 1.2em;
	border-bottom: 1px solid var(--c-border);
}

.peek-title {
	flex-grow: 1;
	min-width: 0;
	outline: none;
	font-size: 1.2em;
}

.peek-date {
	font-size: 0.85em;
	color: var(--c-text-3);
}

.peek-actions {
	display: flex;
	align-items: center;
	gap: 0.6em;
	margin-inline-start: auto;
}

.peek-open {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	font-size: 0.9em;
	color: var(--c-primary);
}

.peek-close {
	display: inline-flex;
	padding: 0.3em;
	border-radius: 0.4em;
	font-size: 1.1em;

	&:hover {
		background-color: var(--c-bg-2);
	}
}

.peek-body {
	flex-grow: 1;
	overflow-y: auto;
	padding: 0.5em 1.5em 2em;
}

.peek-notice {
	margin: 2em 0;
	text-align: center;
	color: var(--c-text-2);

	a {
		color: var(--c-primary);
	}
}
</style>
