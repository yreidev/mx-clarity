<script setup lang="ts">
import type { CommentProps, CommentSubmitResult, CommentThread } from '~/types/comment'

/**
 * 一层楼：顶层评论 + 楼中楼。回复是扁平的，按时间排；
 * 回复的不是楼主时显示「回复 @谁」。超过 20 条回复时中段折叠，点开每次补 10 条。
 */
const props = defineProps<{
	thread: CommentThread
}>()

const t = useT()
const api = useCommentApi()
const { replyingTo } = useCommentContext()

const replies = ref<CommentProps[]>([...props.thread.replies])
const hidden = ref(props.thread.hidden)
const expanding = ref(false)
const expandFailed = ref(false)

const authors = computed(() => new Map([props.thread, ...replies.value].map(c => [c.id, c.author])))

function toggleReply(id: string) {
	replyingTo.value = replyingTo.value === id ? undefined : id
}

/** 折叠的中段接在游标那条之后：core 的游标就是上一批（起初是头 3 条）的最后一条 */
async function expand() {
	if (!hidden.value || expanding.value)
		return
	expanding.value = true
	expandFailed.value = false
	try {
		const { cursor, count } = hidden.value
		const batch = await api.thread(props.thread.id, cursor)
		const at = replies.value.findIndex(reply => reply.id === cursor) + 1
		replies.value.splice(at, 0, ...batch.replies)
		const left = count - batch.replies.length
		hidden.value = batch.cursor && left > 0 ? { count: left, cursor: batch.cursor } : undefined
	}
	catch {
		expandFailed.value = true
	}
	finally {
		expanding.value = false
	}
}

function onReplied(result: CommentSubmitResult) {
	if (result.status !== 'visible')
		return
	replyingTo.value = undefined
	const at = replies.value.findIndex(reply => reply.id === result.comment.id)
	if (at >= 0)
		replies.value[at] = { ...result.comment }
	else
		replies.value.push(result.comment)
}

// 这层楼里别人刚发的回复：按 id 去重，接在最后并标「新」；删掉的移走
useLiveMessages((message) => {
	if (message.type === 'comment-edit') {
		const reply = replies.value.find(item => item.id === message.id)
		if (reply)
			Object.assign(reply, { body: message.body, editedAt: message.editedAt })
	}
	else if (message.type === 'comment-delete') {
		replies.value = replies.value.filter(reply => reply.id !== message.id)
	}
	else if (message.type === 'comment' && message.rootId === props.thread.id && !replies.value.some(reply => reply.id === message.comment.id)) {
		replies.value.push({ ...message.comment, fresh: true })
	}
})
</script>

<template>
<CommentItem :comment="thread" class="comment-thread" top-level @reply="toggleReply(thread.id)">
	<CommentForm
		v-if="replyingTo === thread.id"
		:parent-id="thread.id"
		:reply-to="thread.author"
		@submitted="onReplied"
		@cancel="replyingTo = undefined"
	/>

	<div v-if="replies.length" class="comment-replies">
		<template v-for="reply in replies" :key="reply.id">
			<CommentItem
				:comment="reply"
				:reply-to-name="reply.parentId ? authors.get(reply.parentId) : undefined"
				@reply="toggleReply(reply.id)"
			>
				<CommentForm
					v-if="replyingTo === reply.id"
					:parent-id="reply.id"
					:reply-to="reply.author"
					@submitted="onReplied"
					@cancel="replyingTo = undefined"
				/>
			</CommentItem>

			<button
				v-if="hidden && reply.id === hidden.cursor"
				type="button"
				class="comment-expand"
				:disabled="expanding"
				@click="expand"
			>
				<Icon name="tabler:dots" />
				{{ expanding ? t('common.loading') : expandFailed ? t('comment.couldntLoadClickRetry') : t('comment.showMoreReplies', { n: hidden.count }) }}
			</button>
		</template>
	</div>
</CommentItem>
</template>

<style scoped>
.comment-replies {
	display: grid;
	gap: 1em;
	margin-top: 0.8em;
	padding-inline-start: 0.8em;
	border-inline-start: 2px solid var(--c-border);
	font-size: 0.95em;
}

.comment-expand {
	display: inline-flex;
	align-items: center;
	justify-self: start;
	gap: 0.3em;
	padding: 0.2em 0.6em;
	border-radius: 0.5em;
	font-size: 0.85em;
	color: var(--c-text-2);
	transition: color 0.1s, background-color 0.2s;

	&:hover:not(:disabled) {
		background-color: var(--c-bg-2);
		color: var(--c-primary);
	}
}
</style>
