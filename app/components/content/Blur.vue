<script setup lang="ts">
defineProps<{
	text?: string
}>()

// 剧透：鼠标悬停时看得到；键盘与读屏靠按钮展开
const revealed = ref(false)
const t = useT()
</script>

<template>
<span
	class="blur"
	:class="{ revealed }"
	role="button"
	tabindex="0"
	:aria-expanded="revealed"
	:aria-label="revealed ? undefined : t('content.spoilerPressReveal')"
	@click="revealed = !revealed"
	@keydown.enter.prevent="revealed = !revealed"
	@keydown.space.prevent="revealed = !revealed"
>
	<span :aria-hidden="!revealed"><slot>{{ text }}</slot></span>
</span>
</template>

<style lang="scss" scoped>
.blur {
	transition: filter 0.2s;
	cursor: pointer;
	filter: blur(4px);

	&:hover, &.revealed {
		filter: blur(0);
	}

	&.revealed {
		cursor: auto;
	}

	&:focus-visible {
		border-radius: 0.2em;
		outline: 2px solid var(--c-primary);
		outline-offset: 2px;
	}
}
</style>
