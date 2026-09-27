<script setup lang="ts">
// 覆盖 @nuxtjs/mdc 的 ProseH3：标题里已有链接时不再包锚点（见 useHeadingAnchor）
defineProps<{ id?: string }>()
const withAnchor = useHeadingAnchor('h3')
</script>

<template>
<h3 :id>
	<a v-if="withAnchor(id, $slots.default?.())" :href="`#${id}`"><slot /></a>
	<slot v-else />
</h3>
</template>
