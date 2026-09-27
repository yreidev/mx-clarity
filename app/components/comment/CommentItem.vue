<script setup lang="ts">
import type { CommentEditResult, CommentProps } from '~/types/comment'
import { flashRange } from '~/utils/quote-locate'
import { anchorBlockById, quoteRangeIn } from '~/utils/selection-anchor'

/**
 * 一条评论：头像、昵称与身份、正文、回复 / 编辑 / 举报。默认插槽放回复框和楼中楼。
 * 自己的评论在发出后 10 分钟内能改（改完的正文由服务端重新渲染）；别人的评论能举报，点过就记在本机；
 * 登录读者能屏蔽别的登录读者（同时举报）。站长能置顶顶层评论、改任何人的评论
 */
const props = defineProps<{
	comment: CommentProps
	/** 楼中楼里回复的是谁；上级在折叠的中段里时不知道，不显示 */
	replyToName?: string
	/** 顶层评论（站长能置顶） */
	topLevel?: boolean
}>()

defineEmits<{
	reply: []
}>()

const t = useT()
const uiLang = useUiLang()
const api = useCommentApi()
const locale = useUiLocale()
const { reader, highlighted, refreshReader, reload } = useCommentContext()
const viewerIsOwner = computed(() => reader.value.reader?.isOwner === true)

const provider = computed(() => props.comment.provider ? providerMeta(props.comment.provider) : undefined)

// 访客设备的时钟常比服务器慢几秒，刚发的评论会显示成「1 秒钟后」；时间不晚于此刻
const date = computed(() => Date.parse(props.comment.date) > Date.now() ? new Date().toISOString() : props.comment.date)

// 改完的正文与原文（再改时预填）
const edited = ref<CommentEditResult & { source: string }>()
const body = computed(() => edited.value?.body ?? props.comment.body)
const editedAt = computed(() => edited.value?.editedAt ?? props.comment.editedAt)
const timeZone = useSiteTimeZone()
const editedTip = computed(() => editedAt.value ? t('comment.edited', { time: toZonedLocaleString(editedAt.value, timeZone.value, 'full', locale.value) }) : undefined)

const mine = computed(() => Boolean(props.comment.authorTag && props.comment.authorTag === reader.value.reader?.tag))
// 挂载后每分钟看一次还能不能改；服务端渲染不出这个按钮（评论区只在浏览器里加载）
const now = useNow({ interval: 60_000 })
const canEdit = computed(() => viewerIsOwner.value || (mine.value && props.comment.source !== undefined && isEditableAt(props.comment.date, now.value.getTime())))

/** 划词评论的「引用」、段落评论的「评论了某段」：跳回正文里的那一段，闪一下 */
const quote = computed(() => (props.comment.anchor && 'quote' in props.comment.anchor ? props.comment.anchor : undefined))
const blockAnchor = computed(() => (props.comment.anchor && 'block' in props.comment.anchor ? props.comment.anchor : undefined))
function jumpToQuote() {
	const root = document.querySelector('#main-content article.article')
	const blockId = quote.value?.blockId ?? blockAnchor.value?.blockId
	const block = blockId && root ? anchorBlockById(root, blockId) : undefined
	if (!block)
		return
	let range = quote.value ? quoteRangeIn(block, quote.value.quote) : undefined
	if (!range) {
		range = document.createRange()
		range.selectNodeContents(block)
	}
	flashRange(range)
}

// 悬停联动：停在引用上，正文里那一段加悬停底色；正文里停在下划线上，这条标出来
const hovered = useHoveredAnchor()
const anchorHovered = computed(() => hovered.value?.ids.includes(props.comment.id) === true)
function hoverQuote(on: boolean) {
	hovered.value = on && quote.value ? { blockId: quote.value.blockId, quote: quote.value.quote, ids: [props.comment.id] } : undefined
}

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const message = ref('')

async function startEdit() {
	message.value = ''
	let source = edited.value?.source ?? props.comment.source
	// 站长改别人的评论：原文只给评论者本人，先取一次
	if (source === undefined && viewerIsOwner.value)
		source = await api.ownerSource(props.comment.id)
	if (source === undefined) {
		message.value = t('comment.couldntLoadSource')
		return
	}
	draft.value = source
	editing.value = true
}

async function saveEdit() {
	const text = draft.value
	if (saving.value || !text.trim())
		return
	saving.value = true
	message.value = ''
	try {
		const result = await (viewerIsOwner.value ? api.ownerEdit(props.comment.id, text) : api.edit(props.comment.id, text))
		edited.value = { ...result, source: text }
		editing.value = false
	}
	catch (error) {
		message.value = serverErrorMessage(error, t('comment.couldntSavePlease'))
		if ((error as { statusCode?: number }).statusCode === 401)
			await refreshReader()
	}
	finally {
		saving.value = false
	}
}

// 举报过的评论记在本机，按钮换成「已举报」（core 同样按 IP 去重，重复点也只算一次）
const reportedIds = useLocalStorage<string[]>('mx-clarity:comment-reported', [])
const reported = computed(() => reportedIds.value.includes(props.comment.id))
const reporting = ref(false)
const confirmingReport = ref(false)

// 站长：置顶或取消置顶（core 会清掉同篇别的置顶），做完重新加载评论区
const pinning = ref(false)
async function togglePin() {
	if (pinning.value)
		return
	pinning.value = true
	message.value = ''
	try {
		await api.pin(props.comment.id, !props.comment.pinned)
		await reload()
	}
	catch (error) {
		message.value = serverErrorMessage(error, t('comment.couldntUpdatePin'))
	}
	finally {
		pinning.value = false
	}
}

// 登录读者屏蔽别的登录读者：core 同时举报这条，撤销不了；做完重新加载，这个人的评论就不见了
const canBlock = computed(() => Boolean(reader.value.reader) && !viewerIsOwner.value && props.comment.identity === 'reader' && !mine.value)
const confirmingBlock = ref(false)
const blocking = ref(false)
async function block() {
	if (blocking.value)
		return
	blocking.value = true
	message.value = ''
	try {
		await api.block(props.comment.id)
		confirmingBlock.value = false
		await reload()
	}
	catch (error) {
		message.value = serverErrorMessage(error, t('comment.couldntBlockPlease'))
		if ((error as { statusCode?: number }).statusCode === 401)
			await refreshReader()
	}
	finally {
		blocking.value = false
	}
}

async function report() {
	if (reporting.value || reported.value)
		return
	reporting.value = true
	message.value = ''
	try {
		await api.report(props.comment.id)
		// 只记最近 200 条
		reportedIds.value = [...reportedIds.value, props.comment.id].slice(-200)
		confirmingReport.value = false
	}
	catch (error) {
		message.value = serverErrorMessage(error, t('comment.couldntSendReport'))
	}
	finally {
		reporting.value = false
	}
}
</script>

<template>
<article :id="`comment-${comment.id}`" class="comment-item" :class="{ 'highlighted': highlighted === comment.id, 'anchor-hovered': anchorHovered }">
	<img
		v-if="comment.avatar"
		class="comment-avatar"
		:src="comment.avatar"
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
	>
	<div v-else class="comment-avatar placeholder">
		<Icon name="tabler:user" />
	</div>

	<div class="comment-main">
		<header class="comment-header">
			<a
				v-if="comment.url"
				class="comment-author"
				:href="comment.url"
				target="_blank"
				rel="noopener noreferrer nofollow ugc"
			>{{ visitorNameText(uiLang, comment.author) }}</a>
			<span v-else class="comment-author">{{ visitorNameText(uiLang, comment.author) }}</span>

			<span v-if="comment.identity === 'owner'" class="comment-badge primary">{{ t('common.owner') }}</span>
			<span v-if="comment.member" class="comment-badge member">{{ t('comment.member') }}</span>
			<span v-if="provider" class="comment-provider" :title="t('comment.signedInWith', { provider: provider.name })">
				<Icon :name="provider.icon" />
				<span class="visually-hidden">{{ t('comment.signedInWith', { provider: provider.name }) }}</span>
			</span>
			<span v-if="comment.pinned" class="comment-badge">{{ t('comment.pinned') }}</span>
			<span v-if="comment.fresh" class="comment-badge primary">{{ t('comment.new') }}</span>
			<span v-if="replyToName" class="comment-reply-to">{{ t('comment.replyingTo', { name: replyToName }) }}</span>
			<UtilDate class="comment-date" :date />
			<span v-if="editedAt" class="comment-edited" :title="editedTip">{{ t('comment.edited2') }}</span>
			<span v-if="comment.location" class="comment-location">{{ t('comment.from', { location: comment.location }) }}</span>
			<span v-if="comment.agent" class="comment-agent">{{ comment.agent.split(' · ').map(part => t(part)).join(' · ') }}</span>
		</header>

		<form v-if="editing" class="comment-edit" @submit.prevent="saveEdit">
			<textarea
				v-model="draft"
				maxlength="500"
				rows="3"
				:aria-label="t('comment.editComment')"
				:disabled="saving"
				@keydown.ctrl.enter.prevent="saveEdit"
				@keydown.meta.enter.prevent="saveEdit"
			/>
			<div class="comment-edit-actions">
				<span class="comment-edit-count">{{ draft.length }}/500</span>
				<button type="button" class="comment-action" @click="editing = false">
					{{ t('common.cancel') }}
				</button>
				<ZButton type="submit" primary :text="saving ? t('common.saving') : t('common.save')" :disabled="saving || !draft.trim()" />
			</div>
		</form>
		<template v-else>
			<button v-if="quote" type="button" class="comment-quote" :title="t('comment.jumpPassageText')" @click="jumpToQuote" @mouseenter="hoverQuote(true)" @mouseleave="hoverQuote(false)">
				{{ t('comment.quote') }}<q>{{ quote.quote }}</q>
			</button>
			<button v-else-if="blockAnchor" type="button" class="comment-quote" :title="t('comment.jumpPassageText')" @click="jumpToQuote">
				{{ t('comment.commentedOn', { block: blockAnchor.block }) }}
			</button>
			<p v-else-if="comment.anchor" class="comment-quote stale">
				{{ 'mode' in comment.anchor && comment.anchor.mode === 'block' ? t('comment.commentedParagraphNo') : t('comment.quotedPassageNo') }}
			</p>
			<CommentBody :body />
		</template>

		<footer class="comment-footer">
			<button type="button" class="comment-action" @click="$emit('reply')">
				<Icon name="tabler:message-circle" />{{ t('comment.reply') }}
			</button>
			<button v-if="canEdit && !editing" type="button" class="comment-action" @click="startEdit">
				<Icon name="tabler:edit" />{{ t('comment.edit') }}
			</button>
			<button v-if="viewerIsOwner && topLevel" type="button" class="comment-action" :disabled="pinning" @click="togglePin">
				<Icon :name="comment.pinned ? 'tabler:pinned-off' : 'tabler:pin'" />{{ comment.pinned ? t('comment.unpin') : t('comment.pin') }}
			</button>
			<template v-if="canBlock">
				<template v-if="confirmingBlock">
					<span class="comment-action-text">{{ t('comment.wontSeePersons') }}</span>
					<button type="button" class="comment-action danger" :disabled="blocking" @click="block">
						{{ blocking ? t('comment.blocking') : t('comment.block') }}
					</button>
					<button type="button" class="comment-action" @click="confirmingBlock = false">
						{{ t('common.cancel2') }}
					</button>
				</template>
				<button v-else type="button" class="comment-action" @click="confirmingBlock = true">
					<Icon name="tabler:user-off" />{{ t('comment.blockPerson') }}
				</button>
			</template>
			<template v-if="!mine && !viewerIsOwner && comment.identity !== 'owner'">
				<span v-if="reported" class="comment-action done">
					<Icon name="tabler:flag-check" />{{ t('comment.reported') }}
				</span>
				<template v-else-if="confirmingReport">
					<span class="comment-action-text">{{ t('comment.reportOwner') }}</span>
					<button type="button" class="comment-action danger" :disabled="reporting" @click="report">
						{{ reporting ? t('comment.sending2') : t('comment.report') }}
					</button>
					<button type="button" class="comment-action" @click="confirmingReport = false">
						{{ t('common.cancel2') }}
					</button>
				</template>
				<button v-else type="button" class="comment-action" @click="confirmingReport = true">
					<Icon name="tabler:flag" />{{ t('comment.report') }}
				</button>
			</template>
		</footer>
		<p v-if="message" class="comment-message" role="alert">
			{{ t(message) }}
		</p>

		<slot />
	</div>
</article>
</template>

<style lang="scss" scoped>
.comment-item {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 0.8em;
	border-radius: 0.6em;
	transition: background-color 0.6s, box-shadow 0.6s;
	scroll-margin-top: 5rem;

	// 按 #comment-<id> 定位到的那一条
	&.highlighted {
		box-shadow: 0 0 0 0.4em var(--c-primary-soft);
		background-color: var(--c-primary-soft);
	}
}

.comment-avatar {
	width: 2.5em;
	height: 2.5em;
	border-radius: 50%;
	object-fit: cover;

	@supports (corner-shape: squircle) {
		corner-shape: superellipse(1.2);
	}

	&.placeholder {
		display: grid;
		place-items: center;
		background-color: var(--c-bg-2);
		color: var(--c-text-3);
	}
}

.comment-main {
	min-width: 0;
}

.comment-header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.2em 0.6em;
	font-size: 0.85em;
}

.comment-author {
	font-family: var(--font-creative);
	font-size: 1.05em;
	color: var(--c-text);

	&:is(a):hover {
		color: var(--c-primary);
	}
}

.comment-badge {
	padding: 0 0.4em;
	border-radius: 0.3em;
	background-color: var(--c-bg-2);
	font-size: 0.85em;
	color: var(--c-text-2);

	&.primary {
		background-color: var(--c-primary-soft);
		color: var(--c-primary);
	}

	// 会员：金色，和站长的主色区分开
	&.member {
		background-color: #F5A62333;
		color: #B7791F;
	}
}

.comment-provider {
	display: inline-flex;
	color: var(--c-text-2);
}

.comment-reply-to, .comment-date, .comment-agent, .comment-edited, .comment-location {
	color: var(--c-text-3);
}

.comment-footer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.2em 0.4em;
	font-size: 0.8em;
}

.comment-action {
	display: inline-flex;
	align-items: center;
	gap: 0.2em;
	padding: 0.1em 0.3em;
	border-radius: 0.3em;
	color: var(--c-text-3);
	transition: color 0.1s, background-color 0.2s;

	&:is(button):hover:not(:disabled) {
		background-color: var(--c-bg-2);
		color: var(--c-primary);
	}

	&.danger {
		color: var(--c-error);
	}
}

.comment-action-text {
	color: var(--c-text-2);
}

.comment-message {
	font-size: 0.85em;
	color: var(--c-error);
}

.comment-edit {
	display: grid;
	gap: 0.5em;
	margin: 0.4em 0;

	textarea {
		width: 100%;
		min-height: 5em;
		padding: 0.4em 0.7em;
		border: 1px solid var(--c-border);
		border-radius: 0.5em;
		background-color: var(--c-bg-2);
		font-family: var(--font-monospace);
		font-size: 0.9em;
		color: var(--c-text);
		resize: vertical;

		&:focus-visible {
			border-color: var(--c-primary);
			outline: none;
		}
	}
}

.comment-edit-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.8em;
	font-size: 0.9em;
}

.comment-edit-count {
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
}

.anchor-hovered > .comment-main {
	border-radius: 0.4em;
	box-shadow: 0 0 0 0.4em color-mix(in srgb, var(--c-primary) 10%, transparent);
	background-color: color-mix(in srgb, var(--c-primary) 10%, transparent);
}

.comment-quote {
	display: block;
	overflow-wrap: anywhere;
	margin: 0.3em 0;
	padding: 0.2em 0.6em;
	border-inline-start: 3px solid var(--c-primary-soft);
	font-size: 0.85em;
	text-align: start;
	color: var(--c-text-2);

	&:hover:not(.stale) {
		border-color: var(--c-primary);
		color: var(--c-text);
	}

	&.stale {
		border-color: var(--c-border);
		color: var(--c-text-3);
	}
}

.visually-hidden {
	position: absolute;
	overflow: hidden;
	width: 1px;
	height: 1px;
	clip-path: inset(50%);
	white-space: nowrap;
}
</style>
