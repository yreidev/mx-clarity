<script setup lang="ts">
import type { MDCRoot } from '@nuxtjs/mdc'
import MDCRenderer from '@nuxtjs/mdc/runtime/components/MDCRenderer.vue'
import { contentComponentsFor } from '~/utils/content-components'

/**
 * 正文渲染器，取代 Nuxt Content 的 `ContentRenderer`。
 * `MDCRenderer` 自己只认全局组件，blog-v3 的内容组件都是局部的，这里按正文里实际出现的标签给它组件表
 */
const props = withDefaults(defineProps<{
	body: MDCRoot
	tag?: string
}>(), {
	tag: 'div',
})

const components = computed(() => contentComponentsFor(props.body))
</script>

<template>
<MDCRenderer v-if="body.children?.length" :body :tag :components />
</template>
