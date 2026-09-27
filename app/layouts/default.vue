<script setup lang="ts">
const { slots } = inject<any>(Symbol.for('dxup:layout-slots')) || {}
// 站内跳转取数期间标上 aria-busy，读屏知道内容在换（与顶部进度条同一个状态）
const { isLoading } = useLoadingIndicator()

// 多语言前缀版里除了文章、日记、独立页（它们自己管 hreflang 与 noindex）都不让搜索引擎收录：
// 列表只有标题换成译文，说说、友链这些内容本来就不翻译，收录了就是重复页
const route = useRoute()
const LOCALIZED_DETAILS = new Set(['lang-posts-category-slug', 'lang-notes-path', 'lang-slug'])
useHead(() => (route.params.lang && !LOCALIZED_DETAILS.has(String(route.name)) ? { meta: [{ name: 'robots', content: 'noindex, follow' }] } : {}))
</script>

<template>
<NuxtLoadingIndicator />
<NuxtRouteAnnouncer :style="{ position: 'absolute' }" />
<BlogSkipToContent />
<BlogSidebar />
<div id="content">
	<main id="main-content" :aria-busy="isLoading || undefined">
		<slot />
		<BlogFooter />
	</main>
	<BlogAside>
		<slot name="aside" />
	</BlogAside>
</div>
<BlogPanel :has-aside="!!slots?.aside" />
<BikariyaModals />
<!-- 站内链接预览、新发布的实时提醒：只在浏览器里挂监听 -->
<ClientOnly>
	<LazyPopoverPeek />
	<LazyBlogLiveNotice />
</ClientOnly>
</template>

<!-- eslint-disable-next-line vue/enforce-style-attribute -->
<style lang="scss">
// 预览弹窗开着时底下的页面不滚动
html.peek-open {
	overflow: hidden;
}

#blog-root {
	display: flex;
	justify-content: center;
	gap: 1rem;
	min-width: 0;
}

#blog-sidebar, #blog-aside {
	flex: 0 0 280px; // 防止搜索框 grow
	position: sticky;
	top: 0;
	height: 100vh;
	height: 100dvh;
	min-width: 0; // 防止搜索框撑开页面
	scrollbar-width: thin;

	@media (max-width: $breakpoint-widescreen) {
		flex-shrink: 0.2;
	}
}

#content {
	display: flex;
	gap: 1rem;

	// 若设置的是 max-width，则内部 main 宽度为 fit-content，可能无法撑满
	// 此时即使设置 flex-grow，也会影响 #sidebar 无法正确 shrink
	width: $breakpoint-widescreen;
	min-width: 0; // 解决父级 flexbox 设置 justify-content: center 时溢出左侧消失的问题

	// 此处不建议给内容设置 padding
	> #main-content {
		flex-grow: 1; // 使较小宽度的内容占满

		// overflow: hidden; // 会使一部分元素吸顶失效

		// 使内容正确计算宽度而不横向溢出
		// 也可设置 width: 0 或者 contain: inline-size（兼容性不佳）
		min-width: 0;
	}
}
</style>
