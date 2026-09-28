<script setup lang="ts">
/**
 * 图集（Lexical 的 gallery）：网格、瀑布流或横向滑动，里面每张图仍是 `Pic`。
 * 属性在服务端洗过：布局只有三种，`fit` 只有 cover / contain，最大高度是 80–2000 的整数
 */
const props = withDefaults(defineProps<{
	layout?: 'grid' | 'masonry' | 'carousel'
	fit?: 'cover' | 'contain'
	maxHeight?: number
}>(), {
	layout: 'grid',
	fit: 'cover',
})

const t = useT()
const style = computed(() => Number.isInteger(props.maxHeight) && props.maxHeight! >= 80 && props.maxHeight! <= 2000
	? { '--gallery-max-height': `${props.maxHeight}px` }
	: undefined)
</script>

<template>
<div
	class="mx-gallery"
	:class="[`is-${layout}`, `fit-${fit}`]"
	:style
	:role="layout === 'carousel' ? 'region' : undefined"
	:aria-label="layout === 'carousel' ? t('content.gallery') : undefined"
	:tabindex="layout === 'carousel' ? 0 : undefined"
>
	<slot />
</div>
</template>

<style scoped>
.mx-gallery {
	--gallery-max-height: 24rem;

	margin: 1.5em 0;

	:deep(figure) {
		margin: 0;
	}

	:deep(img) {
		width: 100%;
		max-height: var(--gallery-max-height);
		border-radius: 0.5em;
	}

	&.fit-cover :deep(img) {
		height: 100%;
		object-fit: cover;
	}

	&.fit-contain :deep(img) {
		object-fit: contain;
	}

	&.is-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.5em;
	}

	&.is-masonry {
		columns: 12rem;
		column-gap: 0.5em;

		:deep(figure) {
			margin-bottom: 0.5em;
			break-inside: avoid;
		}
	}

	&.is-carousel {
		display: flex;
		gap: 0.5em;
		overflow-x: auto;
		padding-bottom: 0.3em;
		scroll-snap-type: x mandatory;

		:deep(figure) {
			flex: 0 0 min(80%, 28rem);
			scroll-snap-align: center;
		}

		&:focus-visible {
			border-radius: 0.5em;
			outline: 2px solid var(--c-primary);
		}
	}
}
</style>
