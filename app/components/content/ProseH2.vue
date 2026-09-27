<script setup lang="ts">
// 覆盖 @nuxtjs/mdc 的 ProseH2：标题里已有链接时不再包锚点（见 useHeadingAnchor）
defineProps<{ id?: string }>()
const withAnchor = useHeadingAnchor('h2')
</script>

<template>
<h2 :id>
	<a v-if="withAnchor(id, $slots.default?.())" :href="`#${id}`"><slot /></a>
	<slot v-else />
</h2>
</template>
