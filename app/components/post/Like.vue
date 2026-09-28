<script setup lang="ts">
/**
 * 文章、日记正文后面的点赞按钮，放在 `PostActions` 里（胶囊样式在那边）。core 按访客 IP 去重、不能取消，但去重记录每天零点清空；
 * 「赞过」记在浏览器里，同一浏览器赞过就不能再点
 */
const props = defineProps<{
	kind: 'post' | 'note'
	id: string
	count?: number
}>()

const t = useT()
const uiLang = useUiLang()
const { isLiked, shownCount, pending, message, like } = useLike(props.kind, () => props.id, () => props.count)
</script>

<template>
<div class="post-like">
	<button
		type="button"
		class="post-action post-like-button"
		:class="{ liked: isLiked }"
		:disabled="pending || isLiked"
		:aria-pressed="isLiked"
		@click="like"
	>
		<Icon :name="isLiked ? 'tabler:heart-filled' : 'tabler:heart'" />
		<span>{{ isLiked ? t('post.liked') : t('post.like') }}</span>
		<span v-if="shownCount" class="post-like-count">{{ formatNumber(shownCount, uiLang) }}</span>
	</button>
	<p v-if="message" class="post-like-message" role="alert">
		{{ message }}
	</p>
</div>
</template>

<style scoped>
/* 已赞的样子要盖过 `PostActions` 里的胶囊样式，多套一层选择器 */
.post-like {
	display: grid;
	justify-items: center;
	gap: 0.4em;

	> .post-like-button.liked {
		border-color: var(--c-primary);
		background-color: var(--c-primary-soft);
		color: var(--c-primary);
		cursor: default;
	}

	> .post-like-button:disabled:not(.liked) {
		cursor: wait;
	}
}

.post-like-count {
	font-variant-numeric: tabular-nums;
}

.post-like-message {
	font-size: 0.85em;
	color: var(--c-danger, #D33);
}
</style>
