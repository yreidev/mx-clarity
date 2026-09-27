<script setup lang="ts">
import type { CommentAnchorDraft, CommentSubmitResult } from '~/types/comment'

/**
 * 写评论。登录了就以读者身份发，否则在站点允许时以匿名身份发；
 * 匿名身份的昵称、邮箱、网址记在本机浏览器里，下次免填。
 */
const props = defineProps<{
	/** 回复哪一条；顶层评论不带 */
	parentId?: string
	replyTo?: string
	/** 讨论弹层里的评论框：固定带这个锚点（不用正文里点「评论这段」记下的那个） */
	anchorDraft?: CommentAnchorDraft
	/** 紧凑的评论框（讨论弹层里）：不接「引用评论」的预填 */
	compact?: boolean
}>()

const emit = defineEmits<{
	submitted: [result: CommentSubmitResult]
	cancel: []
}>()

const t = useT()
const api = useCommentApi()
const { refId, reader, allowGuest, refreshReader } = useCommentContext()
// 划词评论：正文里点了「评论这段」的那段，只给主评论框；讨论弹层里的框固定带它自己的锚点
const anchor = useCommentAnchor()
const quoted = computed(() => props.anchorDraft ?? (props.parentId || props.compact ? undefined : anchor.value))
const highlightRevision = useState('mx-comment-highlights', () => 0)

const guest = useLocalStorage('mx-clarity:comment-guest', { author: '', mail: '', url: '' }, { mergeDefaults: true })
const text = ref('')
const whisper = ref(false)
const pending = ref(false)
const notice = ref<{ kind: 'error' | 'info', text: string }>()

const textarea = useTemplateRef('textarea')
const emojiOpen = ref(false)
/** 常用表情；插入的是 Unicode 字符，不是图片 */
const EMOJIS = ['😀', '😄', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔', '🤨', '😐', '😅', '😓', '🥺', '😭', '😡', '😱', '😴', '🤮', '🤡', '👻', '👍', '👎', '👏', '🙏', '💪', '👀', '🎉', '❤️', '💔', '🔥']

/** 插在光标处，插完光标停在表情后面 */
function insertEmoji(emoji: string) {
	const el = textarea.value
	const start = el?.selectionStart ?? text.value.length
	const end = el?.selectionEnd ?? start
	const next = `${text.value.slice(0, start)}${emoji}${text.value.slice(end)}`
	if (next.length > 500)
		return
	text.value = next
	nextTick(() => {
		el?.focus()
		el?.setSelectionRange(start + emoji.length, start + emoji.length)
	})
}

watch(quoted, (value) => {
	if (value && !props.anchorDraft)
		nextTick(() => textarea.value?.focus({ preventScroll: true }))
})

// 「引用评论」：把 `> 选中的文字` 加在主评论框最前面
const quoteDraft = useCommentQuote()
watch(quoteDraft, (value) => {
	if (!value || props.parentId || props.compact || props.anchorDraft)
		return
	text.value = `> ${value}\n\n${text.value}`.slice(0, 500)
	quoteDraft.value = undefined
	nextTick(() => textarea.value?.focus({ preventScroll: true }))
}, { immediate: true })

const me = computed(() => reader.value.reader)
const providers = computed(() => reader.value.providers)
const canPost = computed(() => Boolean(me.value) || allowGuest.value)
const identityParts = computed(() => t('comment.commentingAs').split('{name}'))

async function submit() {
	if (pending.value || !text.value.trim())
		return
	pending.value = true
	notice.value = undefined
	try {
		const result = await api.post(refId, {
			text: text.value,
			as: me.value ? 'reader' : 'guest',
			parentId: props.parentId,
			whisper: (!props.parentId && whisper.value) || undefined,
			guest: me.value ? undefined : { ...guest.value, url: guest.value.url || undefined },
			anchor: quoted.value && { blockId: quoted.value.blockId, mode: quoted.value.mode, quote: quoted.value.quote, prefix: quoted.value.prefix, suffix: quoted.value.suffix },
		})
		text.value = ''
		whisper.value = false
		if (quoted.value) {
			if (!props.anchorDraft)
				anchor.value = undefined
			highlightRevision.value++
		}
		if (result.status === 'pending')
			notice.value = { kind: 'info', text: t('comment.commentSubmittedWill') }
		else if (result.status === 'whisper')
			notice.value = { kind: 'info', text: t('comment.whisperSentOnly') }
		// 发评论的响应里没有读者表那一截，认不出站长；本地插入时按当前身份补上，刷新后以列表为准
		const identity = me.value?.isOwner ? 'owner' as const : result.comment.identity
		emit('submitted', { ...result, comment: { ...result.comment, identity } })
	}
	catch (error) {
		notice.value = { kind: 'error', text: t(serverErrorMessage(error, t('comment.commentWasntSent'))) }
		// 会话失效时刷新身份，表单会换成匿名或登录按钮
		if ((error as { statusCode?: number }).statusCode === 401)
			await refreshReader()
	}
	finally {
		pending.value = false
	}
}

async function login(provider: string) {
	notice.value = undefined
	try {
		await signInWith(provider, 'comments')
	}
	catch {
		notice.value = { kind: 'error', text: t('common.couldntStartSign') }
	}
}

async function logout() {
	await signOut().catch(() => undefined)
	await refreshReader()
}
</script>

<template>
<form class="comment-form" @submit.prevent="submit">
	<p v-if="replyTo" class="comment-form-reply">
		{{ t('comment.replyingTo', { name: replyTo }) }}
	</p>
	<div v-if="quoted" class="comment-form-quote">
		<span v-if="quoted.mode === 'block'">{{ quoted.excerpt ? t('comment.commentingOnThisParagraph') : t('comment.commentingParagraph') }}<q v-if="quoted.excerpt">{{ quoted.excerpt }}</q></span>
		<span v-else>{{ t('comment.quote') }}<q>{{ quoted.quote }}</q></span>
		<button v-if="!anchorDraft" type="button" class="comment-form-link" :aria-label="t('comment.removeQuote')" @click="anchor = undefined">
			<Icon name="tabler:x" />
		</button>
	</div>

	<div v-if="me" class="comment-form-identity">
		<img
			v-if="me.avatar"
			class="comment-form-avatar"
			:src="me.avatar"
			alt=""
			referrerpolicy="no-referrer"
		>
		<span>{{ identityParts[0] }}<b>{{ me.name }}</b>{{ identityParts[1] }}</span>
		<span v-if="me.isOwner" class="comment-form-badge">{{ t('common.owner') }}</span>
		<button type="button" class="comment-form-link" @click="logout">
			{{ t('common.signOut') }}
		</button>
	</div>
	<div v-else-if="allowGuest" class="comment-form-guest">
		<input
			v-model.trim="guest.author"
			required
			maxlength="20"
			:placeholder="t('comment.nickname')"
			:aria-label="t('comment.nickname')"
			autocomplete="nickname"
		>
		<input
			v-model.trim="guest.mail"
			type="email"
			required
			maxlength="50"
			:placeholder="t('comment.emailNotShown')"
			:aria-label="t('comment.emailNotShownPublicly')"
			autocomplete="email"
		>
		<input
			v-model.trim="guest.url"
			type="url"
			maxlength="50"
			:placeholder="t('comment.websiteOptional')"
			:aria-label="t('comment.websiteOptional2')"
			autocomplete="url"
		>
	</div>

	<div v-if="!me && providers.length" class="comment-form-login">
		<span>{{ allowGuest ? t('comment.signComment') : t('comment.signInToComment') }}</span>
		<button
			v-for="provider in providers"
			:key="provider"
			type="button"
			class="comment-form-provider"
			@click="login(provider)"
		>
			<Icon :name="providerMeta(provider).icon" />{{ providerMeta(provider).name }}
		</button>
	</div>

	<template v-if="canPost">
		<textarea
			ref="textarea"
			v-model="text"
			maxlength="500"
			rows="3"
			:placeholder="parentId ? t('comment.writeReplyMarkdown') : t('comment.saySomethingMarkdown')"
			:aria-label="t('comment.commentText')"
			:disabled="pending"
			@keydown.ctrl.enter.prevent="submit"
			@keydown.meta.enter.prevent="submit"
		/>
		<div v-if="emojiOpen" class="comment-form-emojis" role="group" :aria-label="t('common.emoji')">
			<button
				v-for="emoji in EMOJIS"
				:key="emoji"
				type="button"
				:aria-label="t('comment.insert', { emoji })"
				@click="insertEmoji(emoji)"
			>
				{{ emoji }}
			</button>
		</div>
		<div class="comment-form-actions">
			<button
				type="button"
				class="comment-form-emoji-toggle"
				:aria-expanded="emojiOpen"
				:aria-label="t('common.emoji')"
				@click="emojiOpen = !emojiOpen"
			>
				<Icon name="tabler:mood-smile" />
			</button>
			<label v-if="!parentId" class="comment-form-whisper" :title="t('comment.onlyOwnerCan')">
				<input v-model="whisper" type="checkbox"> {{ t('comment.whisper') }}
			</label>
			<span v-else class="comment-form-spacer" />
			<span class="comment-form-count">{{ text.length }}/500</span>
			<button v-if="parentId" type="button" class="comment-form-link" @click="emit('cancel')">
				{{ t('common.cancel') }}
			</button>
			<ZButton type="submit" primary :text="pending ? t('comment.sending') : t('comment.send')" :disabled="pending || !text.trim()" />
		</div>
	</template>
	<p v-else-if="!providers.length" class="comment-form-closed">
		{{ t('comment.onlySignedReaders') }}
	</p>

	<p v-if="notice" class="comment-form-notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
		{{ notice.text }}
	</p>
</form>
</template>

<style lang="scss" scoped>
.comment-form {
	display: grid;
	gap: 0.6em;
	margin: 1em 0;

	input:not([type="checkbox"]), textarea {
		width: 100%;
		min-width: 0;
		padding: 0.4em 0.7em;
		border: 1px solid var(--c-border);
		border-radius: 0.5em;
		background-color: var(--c-bg-2);
		font: inherit;
		color: var(--c-text);
		transition: border-color 0.2s;

		&:focus-visible {
			border-color: var(--c-primary);
			outline: none;
		}
	}

	textarea {
		min-height: 5.5em;
		font-family: var(--font-monospace);
		font-size: 0.9em;
		resize: vertical;
	}
}

.comment-form-quote {
	display: flex;
	align-items: flex-start;
	gap: 0.5em;
	padding: 0.4em 0.7em;
	border-inline-start: 3px solid var(--c-primary);
	border-radius: 0.3em;
	background-color: var(--c-bg-2);
	font-size: 0.85em;
	color: var(--c-text-2);

	> span {
		flex: 1;
		overflow-wrap: anywhere;
		min-width: 0;
	}
}

.comment-form-reply, .comment-form-closed {
	font-size: 0.85em;
	color: var(--c-text-2);
}

.comment-form-identity, .comment-form-login {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4em 0.8em;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.comment-form-avatar {
	width: 1.8em;
	height: 1.8em;
	border-radius: 50%;
}

.comment-form-badge {
	padding: 0 0.4em;
	border-radius: 0.3em;
	background-color: var(--c-primary-soft);
	font-size: 0.85em;
	color: var(--c-primary);
}

.comment-form-guest {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(10em, 1fr));
	gap: 0.6em;
}

.comment-form-provider {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	padding: 0.2em 0.6em;
	border: 1px solid var(--c-border);
	border-radius: 0.5em;
	color: var(--c-text);

	&:hover {
		border-color: var(--c-primary);
		color: var(--c-primary);
	}
}

.comment-form-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: 0.6em 1em;
	font-size: 0.9em;
}

.comment-form-whisper {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	margin-inline-end: auto;
	color: var(--c-text-2);
	cursor: pointer;
}

.comment-form-spacer {
	margin-inline-end: auto;
}

.comment-form-emoji-toggle {
	display: inline-flex;
	padding: 0.2em;
	border-radius: 0.4em;
	font-size: 1.1em;
	color: var(--c-text-3);

	&:hover, &[aria-expanded="true"] {
		color: var(--c-primary);
	}
}

.comment-form-emojis {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(2.2em, 1fr));
	gap: 0.2em;
	padding: 0.4em;
	border: 1px solid var(--c-border);
	border-radius: 0.5em;
	background-color: var(--c-bg-2);

	> button {
		padding: 0.2em;
		border-radius: 0.4em;
		font-size: 1.2em;
		line-height: 1.2;

		&:hover {
			background-color: var(--c-bg);
		}
	}
}

.comment-form-count {
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
}

.comment-form-link {
	color: var(--c-text-3);

	&:hover {
		color: var(--c-primary);
	}
}

.comment-form-notice {
	font-size: 0.9em;
	color: var(--c-text-2);

	&.error {
		color: var(--c-error);
	}
}
</style>
