<script setup lang="ts">
import type { ThinkingProps } from '~/types/note'

/** 一条碎碎念：正文已由服务端按路径 B 渲染；赞、踩可以点 */
const props = defineProps<ThinkingProps & { detail?: boolean }>()

const { mine, up, down, pending, message, vote } = useThinkingVote(() => props.id, { up: () => props.up, down: () => props.down })

const t = useT()
const refLabels = computed(() => ({ post: t('common.post'), note: t('common.diary'), page: t('common.page'), thinking: t('common.thinking') }))
const contextText = computed(() => [props.context?.app, props.context?.window].filter(Boolean).join(' · '))
</script>

<template>
<article class="thinking-item card">
	<MxRenderer class="article thinking-body" :body tag="div" />
	<ProseA v-if="link" :href="link" class="thinking-link">
		{{ link }}
	</ProseA>
	<UtilLink v-if="quoted" :to="quoted.path" class="thinking-ref gradient-card">
		<span class="thinking-ref-kind">{{ refLabels[quoted.kind] }}</span>
		<span class="thinking-ref-title">{{ t(quoted.title) }}</span>
	</UtilLink>
	<p v-if="contextText || context?.media" class="thinking-context">
		<span v-if="contextText"><Icon name="tabler:app-window" /> {{ contextText }}</span>
		<span v-if="context?.media"><Icon name="tabler:music" /> {{ context.media }}</span>
	</p>
	<footer class="thinking-info">
		<UtilLink v-if="!detail" :to="path" class="thinking-date">
			<UtilDate :date icon="tabler:clock" />
		</UtilLink>
		<UtilDate v-else :date icon="tabler:clock" />
		<button
			type="button"
			class="thinking-vote"
			:class="{ active: mine === 'up' }"
			:aria-pressed="mine === 'up'"
			:aria-label="mine === 'up' ? t('thinking.likedClickAgain', { count: up }) : t('thinking.like', { count: up })"
			:disabled="pending"
			@click="vote('up')"
		>
			<Icon :name="mine === 'up' ? 'tabler:thumb-up-filled' : 'tabler:thumb-up'" />{{ up || '' }}
		</button>
		<button
			type="button"
			class="thinking-vote"
			:class="{ active: mine === 'down' }"
			:aria-pressed="mine === 'down'"
			:aria-label="mine === 'down' ? t('thinking.dislikedClickAgain', { count: down }) : t('thinking.dislike', { count: down })"
			:disabled="pending"
			@click="vote('down')"
		>
			<Icon :name="mine === 'down' ? 'tabler:thumb-down-filled' : 'tabler:thumb-down'" />{{ down || '' }}
		</button>
		<!-- 评论数不显示：core 的 commentsIndex 连垃圾与待审核的也算进去 -->
		<UtilLink v-if="!detail && allowComment" :to="`${path}#comments`" class="thinking-comment">
			<Icon name="tabler:message-circle" /> {{ t('thinking.comment') }}
		</UtilLink>
		<span v-if="message" class="thinking-vote-message" role="alert">{{ message }}</span>
	</footer>
</article>
</template>

<style scoped>
.thinking-item {
	display: grid;
	gap: 0.6em;
	margin: 1em 0;
	padding: 1em;
	border-radius: 0.8em;
}

.thinking-ref {
	display: flex;
	align-items: baseline;
	gap: 0.5em;
	padding: 0.5em 0.8em;
	border-radius: 0.5em;
	font-size: 0.9em;
}

.thinking-ref-kind {
	flex-shrink: 0;
	font-size: 0.85em;
	color: var(--c-text-2);
}

.thinking-ref-title {
	overflow: hidden;
	font-weight: 600;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.thinking-context {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3em 1em;
	margin: 0;
	font-size: 0.8em;
	color: var(--c-text-2);
}

.thinking-comment {
	display: inline-flex;
	align-items: center;
	gap: 0.2em;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.thinking-body {
	margin: 0;

	:deep(> :first-child) {
		margin-top: 0;
	}

	:deep(> :last-child) {
		margin-bottom: 0;
	}
}

.thinking-link {
	overflow: hidden;
	font-size: 0.9em;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.thinking-info {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5em 1.2em;
	font-size: 0.8em;
	color: var(--c-text-2);

	> * {
		display: inline-flex;
		align-items: center;
		gap: 0.25em;
	}
}

.thinking-date:hover {
	color: var(--c-primary);
}

.thinking-vote {
	font-variant-numeric: tabular-nums;
	color: inherit;
	transition: color 0.2s;

	&:hover:not(:disabled), &.active {
		color: var(--c-primary);
	}

	&:disabled {
		cursor: wait;
	}
}

.thinking-vote-message {
	color: var(--c-danger, #D33);
}
</style>
