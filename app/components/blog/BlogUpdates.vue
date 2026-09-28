<script setup lang="ts">
import type { SiteUpdates } from '~/types/stats'

/**
 * 首页「有新内容」：浏览器记下上次来访的时间，这次来问一下之后发了什么（接口从缓存算，不打 core）。
 * 第一次来访不提示；看过、关掉都把时间记成现在。时间记在 localStorage，取不到就当第一次来
 */
const t = useT()
const KEY = 'mx-clarity:last-visit'
const updates = ref<SiteUpdates>()

function remember() {
	try {
		localStorage.setItem(KEY, String(Date.now()))
	}
	catch {}
}

onMounted(async () => {
	let since = Number.NaN
	try {
		since = Number(localStorage.getItem(KEY) ?? Number.NaN)
	}
	catch {}
	remember()
	if (!Number.isFinite(since))
		return
	const result = await $fetch<SiteUpdates>('/api/mx/updates', { query: { since } }).catch(() => undefined)
	if (result?.count)
		updates.value = result
})
</script>

<template>
<aside v-if="updates" class="blog-updates" :aria-label="t('site.newContent')">
	<p>
		<Icon name="tabler:sparkles" />
		{{ t('site.newEntriesSince', { n: updates.count }) }}
	</p>
	<ul>
		<li v-for="item in updates.items" :key="item.path">
			<UtilLink :to="item.path">
				{{ item.title }}
			</UtilLink>
		</li>
	</ul>
	<button type="button" class="blog-updates-close" :aria-label="t('site.gotIt')" @click="updates = undefined">
		<Icon name="tabler:x" />
	</button>
</aside>
</template>

<style scoped>
.blog-updates {
	position: relative;
	margin: 1rem;
	padding: 0.8em 2.5em 0.8em 1em;
	border-radius: 0.8em;
	background-color: var(--c-primary-soft);
	font-size: 0.9em;

	p {
		display: flex;
		align-items: center;
		gap: 0.3em;
	}

	ul {
		margin: 0.3em 0 0;
		padding-inline-start: 1.5em;
		list-style: disc;
	}

	a:hover {
		color: var(--c-primary);
	}
}

.blog-updates-close {
	display: inline-flex;
	position: absolute;
	top: 0.6em;
	right: 0.6em;
	padding: 0.2em;
	border-radius: 0.3em;
	color: var(--c-text-2);

	&:hover {
		background-color: var(--c-bg);
	}
}
</style>
