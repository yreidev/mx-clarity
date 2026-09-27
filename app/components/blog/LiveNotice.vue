<script setup lang="ts">
import type { SiteUpdates } from '~/types/stats'

/**
 * 左下角的实时提示（`useLiveNotices` 的队列）：新文章、新日记、正在看的这篇更新了……
 * 新文章、新日记：实时连接只映射成一个「有发布」的信号（core 的这条广播对加密日记也带全文，不从那里取内容），
 * 收到后过几秒问 `/api/mx/updates?since=<打开页面的时间>`（从缓存算，不打 core）。
 * 没配 webhook 时缓存最多 1 分钟才更新：这次没拿到就再等一分钟问一次。同一篇只提示一次
 */
const t = useT()
const openedAt = Date.now()
const shown = new Set<string>()
const notices = useLiveNotices()
const items = notices.items
let timer: ReturnType<typeof setTimeout> | undefined

async function check(retry: boolean) {
	const result = await $fetch<SiteUpdates>('/api/mx/updates', { query: { since: openedAt } }).catch(() => undefined)
	const fresh = (result?.items ?? []).filter(item => !shown.has(item.path))
	if (!fresh.length) {
		if (retry)
			timer = setTimeout(check, 60_000, false)
		return
	}
	for (const item of fresh.slice(0, 3).reverse()) {
		shown.add(item.path)
		notices.push({ text: item.path.startsWith('/notes/') ? t('site.newDiaryEntry') : t('site.newPost'), link: { path: item.path, title: item.title } })
	}
}

useLiveMessages((message) => {
	if (message.type !== 'published')
		return
	clearTimeout(timer)
	timer = setTimeout(check, 5000, true)
})

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
<div class="live-notice" role="status">
	<!-- 语言建议与实时提醒叠在同一个角落：放进同一个容器上下排开 -->
	<BlogLanguageSuggestion />
	<aside v-if="items.length" class="live-notice-card" :aria-label="t('site.liveUpdates')">
		<ul data-peek>
			<li v-for="item in items" :key="item.id">
				<Icon :name="item.link ? 'tabler:sparkles' : 'tabler:refresh'" />
				<template v-if="item.link">
					<span>{{ t('site.labelColon', { text: item.text }) }}</span>
					<UtilLink :to="item.link.path" @click="notices.clear()">
						{{ item.link.title }}
					</UtilLink>
				</template>
				<span v-else>{{ item.text }}</span>
			</li>
		</ul>
		<button type="button" class="live-notice-close" :aria-label="t('site.gotIt')" @click="notices.clear()">
			<Icon name="tabler:x" />
		</button>
	</aside>
</div>
</template>

<style lang="scss" scoped>
.live-notice {
	display: grid;
	gap: 0.6em;
	position: fixed;
	bottom: max(1rem, env(safe-area-inset-bottom));
	left: 1rem;
	// 手机上右下角有浮动按钮，留出它的位置
	max-width: min(24rem, calc(100vw - 5rem));
	z-index: 50;
}

.live-notice-card {
	display: flex;
	align-items: flex-start;
	gap: 0.5em;
	padding: 0.7em 0.8em 0.7em 1em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	box-shadow: var(--box-shadow-2, 0 0.5em 1.5em #0002);
	background-color: var(--c-bg);
	font-size: 0.9em;

	ul {
		display: grid;
		flex: 1;
		gap: 0.3em;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		overflow-wrap: anywhere;

		> .iconify {
			margin-inline-end: 0.3em;
			vertical-align: -0.15em;
			color: var(--c-primary);
		}
	}

	a {
		color: var(--c-primary);
	}
}

.live-notice-close {
	display: inline-flex;
	flex-shrink: 0;
	padding: 0.2em;
	border-radius: 0.3em;
	color: var(--c-text-2);

	&:hover {
		background-color: var(--c-bg-2);
	}
}
</style>
