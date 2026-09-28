<script setup lang="ts">
/** 正文后面的一排按钮（点赞、订阅）：居中，窄了就换行。按钮共用的胶囊样式也在这里（`.post-action`） */
</script>

<template>
<div class="post-actions">
	<slot />
</div>
</template>

<style scoped>
.post-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	justify-content: center;
	gap: 0.8em;
	margin: 2rem 1rem 1rem;

	&:empty {
		display: none;
	}

	:deep(.post-action) {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		padding: 0.5em 1.2em;
		border: 1px solid var(--c-border);
		border-radius: 2em;
		background-color: var(--c-bg-2);
		color: var(--c-text-2);
		transition: color 0.2s, border-color 0.2s, background-color 0.2s;

		&:hover:not(:disabled) {
			border-color: var(--c-primary);
			color: var(--c-primary);
		}
	}
}
</style>
