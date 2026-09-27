<script setup lang="ts">
/**
 * markdown 正文里的图片（路径 B）：宽高、主色、thumbhash 由服务端按文档的 images 表补上（core 给 markdown 文档算的），
 * 加载前按宽高占位、用主色和模糊图垫底。其余与 mdc 自带的 ProseImg 一样
 */
const props = withDefaults(defineProps<{
	src?: string
	alt?: string
	width?: string | number
	height?: string | number
	accent?: string
	thumbhash?: string
}>(), {
	src: '',
	alt: '',
})

const img = useTemplateRef<HTMLImageElement>('img')
const placeholder = useImagePlaceholder(() => ({ accent: props.accent, thumbhash: props.thumbhash }), img)
</script>

<template>
<UtilImg
	ref="img"
	:src
	:alt
	:width
	:height
	:style="placeholder.style.value"
	@load="placeholder.onLoad"
/>
</template>
