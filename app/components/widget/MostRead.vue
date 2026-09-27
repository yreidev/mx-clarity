<script setup lang="ts">
/** 侧栏「阅读最多」：累计阅读最多的文章与日记（归档页）。只在浏览器里取 */
const t = useT()
const uiLang = useUiLang()
const { data } = useMxReadingBoard()
</script>

<template>
<BlogWidget v-if="data?.top.length" card :title="t('site.mostRead')">
	<ol>
		<li v-for="item in data.top" :key="item.path">
			<UtilLink :to="item.path" class="reading-title">
				{{ item.title }}
			</UtilLink>
			<span class="reading-count">{{ formatNumber(item.count, uiLang) }}</span>
		</li>
	</ol>
</BlogWidget>
</template>

<style lang="scss" scoped>
ol {
	display: grid;
	gap: 0.2em;
	font-size: 0.9em;
}

li {
	display: flex;
	align-items: baseline;
	gap: 0.5em;
	min-width: 0;
}

.reading-title {
	flex-grow: 1;
	overflow: hidden;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;

	&:hover {
		color: var(--c-primary);
	}
}

.reading-count {
	flex-shrink: 0;
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
}
</style>
