<script setup lang="ts">
/**
 * 页脚在线人数上方弹出的「正在阅读」：此刻有人在读的文章、日记与独立页，按人数排。
 * 弹出时才挂上，每次弹出都重新取（不用打开页面时取的那份：那时自己还没进房间）；
 * 开着期间每分钟刷新一次，有人进出（在线人数变化）也刷新
 */
const t = useT()
const { data, refresh, status } = useMxReadingBoard()
const { online } = useMxLive()

onMounted(() => refresh())
useIntervalFn(() => refresh(), 60_000)
watchDebounced(online, () => refresh(), { debounce: 3000 })
</script>

<template>
<div class="footer-reading">
	<ol v-if="data?.now.length">
		<li v-for="item in data.now" :key="item.path">
			<UtilLink :to="item.path" class="footer-reading-title">
				{{ item.title }}
			</UtilLink>
			<span class="footer-reading-count">{{ t('site.readers', { n: item.count }) }}</span>
		</li>
	</ol>
	<p v-else-if="status !== 'pending'">
		{{ t('site.nobodyReading') }}
	</p>
</div>
</template>

<style scoped>
/* 贴在在线人数的上方，不占页脚的高度（页脚在页面最底下，往下展开会被截在屏幕外） */
.footer-reading {
	position: absolute;
	inset-inline-start: 0;
	bottom: 100%;
	width: max-content;
	min-width: 12rem;
	max-width: min(24rem, calc(100vw - 2rem));
	margin-bottom: 0.4em;
	padding: 0.5em 0.8em;
	border: 1px solid var(--c-border);
	border-radius: 0.6em;
	box-shadow: var(--box-shadow-2);
	background-color: var(--c-bg);
	font-size: 1rem;
	z-index: var(--z-index-popover);

	ol {
		display: grid;
		gap: 0.3em;
		font-size: 0.85em;
	}

	li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1em;
		min-width: 0;
	}

	p {
		margin: 0;
		font-size: 0.85em;
		color: var(--c-text-3);
	}
}

.footer-reading-title {
	overflow: hidden;
	min-width: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: var(--c-text-1);

	&:hover {
		color: var(--c-primary);
	}
}

.footer-reading-count {
	flex-shrink: 0;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-3);
}
</style>
