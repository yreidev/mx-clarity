<script setup lang="ts">
import type { CommentSubmitResult, CommentThread } from '~/types/comment'

/**
 * 这一段的讨论（点正文里的下划线、或段落边栏的评论图标打开）：引用原文、这一段的每条评论（能就地回复），
 * 底下是一个「回应这段」的评论框（带同一个锚点）。由评论区渲染（用评论区的身份与表单），Teleport 到 body；
 * 宽屏上贴着点击处弹出，窄屏上贴底。Esc 或点外面关掉
 */
const props = defineProps<{
	threads: CommentThread[]
}>()

const emit = defineEmits<{
	submitted: [result: CommentSubmitResult]
}>()

const panel = useAnchorPanel()
const anchored = useAnchoredComments()
const { reload } = useCommentContext()
const t = useT()
const replyTo = ref<string>()

const items = computed(() => (panel.value?.ids ?? []).map(id => ({
	id,
	thread: props.threads.find(thread => thread.id === id),
	info: anchored.value.find(item => item.id === id),
})))

const narrow = useMediaQuery('(max-width: 768px)')
const style = computed(() => {
	if (!panel.value || narrow.value)
		return {}
	const width = Math.min(420, innerWidth - 24)
	return {
		left: `${Math.min(Math.max(12, panel.value.x - 24), innerWidth - width - 12)}px`,
		top: `${Math.min(panel.value.y + 12, innerHeight - 320)}px`,
	}
})

function close() {
	panel.value = undefined
	replyTo.value = undefined
}

onKeyStroke('Escape', () => {
	if (panel.value)
		close()
})

function onSubmitted(result: CommentSubmitResult) {
	emit('submitted', result)
	if (result.status === 'visible' && panel.value && !panel.value.ids.includes(result.comment.id))
		panel.value = { ...panel.value, ids: [result.comment.id, ...panel.value.ids] }
}

async function onReplied(result: CommentSubmitResult) {
	replyTo.value = undefined
	if (result.status === 'visible')
		await reload()
}

function goTo(id: string) {
	close()
	navigateTo({ hash: `#comment-${id}` })
}
</script>

<template>
<Teleport to="body">
	<div v-if="panel" class="anchor-panel-backdrop" @click.self="close">
		<section class="anchor-panel" role="dialog" :aria-label="t('comment.discussionParagraph')" :style>
			<header class="anchor-panel-head">
				<p v-if="panel.draft.mode === 'block'">
					{{ panel.draft.excerpt ? t('comment.thisParagraph2') : t('comment.thisParagraph') }}<q v-if="panel.draft.excerpt">{{ panel.draft.excerpt }}</q>
				</p>
				<p v-else>
					<q>{{ panel.draft.quote }}</q>
				</p>
				<span class="anchor-panel-count">{{ t('comment.comments', { n: items.length }) }}</span>
				<button type="button" class="anchor-panel-close" :aria-label="t('common.close')" @click="close">
					<Icon name="tabler:x" />
				</button>
			</header>

			<ul v-if="items.length" class="anchor-panel-list">
				<li v-for="item in items" :key="item.id">
					<div class="anchor-panel-meta">
						<b>{{ item.thread?.author ?? item.info?.author ?? t('common.anonymous') }}</b>
						<UtilDate v-if="item.thread?.date ?? item.info?.date" :date="(item.thread?.date ?? item.info?.date)!" />
					</div>
					<CommentBody v-if="item.thread" :body="item.thread.body" />
					<p v-else class="anchor-panel-excerpt">
						{{ item.info?.excerpt }}
					</p>
					<div class="anchor-panel-actions">
						<button type="button" @click="replyTo = replyTo === item.id ? undefined : item.id">
							{{ t('comment.reply') }}
						</button>
						<button v-if="(item.thread?.replies.length ?? item.info?.replyCount ?? 0) > 0" type="button" @click="goTo(item.id)">
							{{ t('comment.replies', { n: item.thread?.replies.length ?? item.info?.replyCount ?? 0 }) }}
						</button>
						<button type="button" @click="goTo(item.id)">
							{{ t('comment.viewComments') }}
						</button>
					</div>
					<CommentForm
						v-if="replyTo === item.id"
						compact
						:parent-id="item.id"
						:reply-to="item.thread?.author ?? item.info?.author"
						@submitted="onReplied"
						@cancel="replyTo = undefined"
					/>
				</li>
			</ul>

			<div class="anchor-panel-form">
				<CommentForm compact :anchor-draft="panel.draft" @submitted="onSubmitted" />
			</div>
		</section>
	</div>
</Teleport>
</template>

<style lang="scss" scoped>
.anchor-panel-backdrop {
	position: fixed;
	inset: 0;
	// 要盖过右下角的浮动按钮（弹层层级）：手机上抽屉贴底，不然评论框的「发送」被按钮压住
	z-index: calc(var(--z-index-popover) + 1);
}

.anchor-panel {
	display: grid;
	gap: 0.6em;
	position: fixed;
	overflow-y: auto;
	width: min(420px, calc(100vw - 24px));
	max-height: min(70vh, 36rem);
	padding: 0.8em 1em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	box-shadow: 0 0.6em 2em #0003;
	background-color: var(--c-bg);
	font-size: 0.9em;

	// 窄屏贴底
	@media (max-width: $breakpoint-mobile) {
		inset: auto 0 0;
		width: 100%;
		max-height: 80vh;
		border-radius: 0.8em 0.8em 0 0;
	}
}

.anchor-panel-head {
	display: flex;
	align-items: flex-start;
	gap: 0.5em;

	> p {
		flex: 1;
		overflow-wrap: anywhere;
		min-width: 0;
		margin: 0;
		padding-inline-start: 0.6em;
		border-inline-start: 3px solid var(--c-primary);
		font-style: italic;
		color: var(--c-text-2);
	}
}

.anchor-panel-count {
	flex-shrink: 0;
	font-size: 0.85em;
	color: var(--c-text-3);
}

.anchor-panel-close {
	display: inline-flex;
	flex-shrink: 0;
	padding: 0.1em;
	border-radius: 0.3em;
	color: var(--c-text-2);

	&:hover {
		background-color: var(--c-bg-2);
	}
}

.anchor-panel-list {
	display: grid;
	gap: 0.8em;
	margin: 0;
	padding: 0;
	list-style: none;

	> li {
		display: grid;
		gap: 0.2em;
		padding-bottom: 0.6em;
		border-bottom: 1px solid var(--c-border);
	}
}

.anchor-panel-meta {
	display: flex;
	align-items: baseline;
	gap: 0.6em;
	font-size: 0.9em;
	color: var(--c-text-3);

	> b {
		color: var(--c-text);
	}
}

.anchor-panel-excerpt {
	margin: 0;
}

.anchor-panel-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.8em;
	font-size: 0.85em;

	> button {
		color: var(--c-text-2);

		&:hover {
			color: var(--c-primary);
		}
	}
}
</style>
