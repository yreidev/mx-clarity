<script setup lang="ts">
import type { BundledLanguage } from 'shiki'

withDefaults(defineProps<{
	icon?: string
	title?: string
	message?: string
	code?: string
	language?: BundledLanguage
}>(), {
	icon: 'line-md:cloud-alt-print-twotone-loop',
	language: 'log',
})
</script>

<template>
<div class="error proper-height" role="status">
	<div />
	<Icon class="error-icon" :name="icon" />
	<!-- 纯文本：SSR 期间的任何报错都会显示到这里，报错信息里可能带着输入 -->
	<div class="error-title" v-text="title" />

	<div class="operation">
		<slot name="operation" />
	</div>

	<ProsePre
		v-if="code"
		:filename="message"
		:language
		:code
		meta="wrap"
	/>

	<slot />
</div>
</template>

<style scoped>
.error {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 2rem;

	> .error-icon {
		font-size: 5rem;
		color: var(--c-text-3);
	}

	> .error-title {
		font-size: 1.5rem;
		word-break: break-all;
		color: var(--c-text-3);

		> :deep(pre) {
			font-size: 1rem;
			white-space: pre-wrap;
		}
	}

	> .z-codeblock {
		max-width: 100%;

		:deep(.shiki) {
			background-color: transparent !important;
		}
	}
}
</style>
