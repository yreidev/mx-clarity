<script setup lang="ts">
const t = useT()
</script>

<template>
<!-- 若使用 NuxtLink 则键盘焦点不会切换 -->
<a href="#main-content" class="skip-link gradient-card active">
	{{ t('site.skipContent') }}
</a>
</template>

<style scoped>
.skip-link {
	position: fixed;
	top: -100%;
	width: 80%;
	margin: 1rem;
	padding: 0.5rem;
	text-align: center;
	z-index: calc(infinity);
}

.skip-link:focus {
	top: auto;
}
</style>
