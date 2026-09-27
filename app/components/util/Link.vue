<script setup lang="ts">
const props = defineProps<{ to?: string }>()
// 前缀版里的站内链接保持语言（没有前缀版的地址、站外链接原样）
const localize = useLocalePath()
const target = computed(() => (props.to ? localize(props.to) : props.to))
</script>

<template>
<a v-if="to?.startsWith('#')" :href="to"><slot /></a>
<span v-else-if="typeof to === 'undefined'"><slot /></span>
<NuxtLink v-else :to="target" :target="isExtLink(to) ? '_blank' : undefined">
	<slot />
</NuxtLink>
</template>
