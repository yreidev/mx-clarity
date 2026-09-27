<script setup lang="ts">
const { data: theme } = useMxTheme()
const { data: site } = useMxSite()
// 底部图标：主题配置的在前，站长资料里的社交账号接在后面（同一地址只留一个）
const iconNav = computed(() => {
	const normalize = (url: string) => url.toLowerCase().replace(/\/+$/, '')
	const seen = new Set(theme.value.footer.iconNav.map(item => normalize(item.url)))
	return [...theme.value.footer.iconNav, ...site.value.social.filter(item => !seen.has(normalize(item.url)))]
})
const layoutStore = useLayoutStore()
const searchStore = useSearchStore()

const { text } = useTextSelection()
const debouncedSelection = refDebounced(text)

// 导航链接取主题配置（admin 的 theme/mx-clarity 片段，默认 8 项）；mx 的独立页接在后面
const navGroups = computed(() => [{ title: '', items: theme.value.nav }])
const { data: pageLinks } = useMxPageLinks()
const t = useT()
</script>

<template>
<BlogMask
	:show="layoutStore.state === 'sidebar'"
	class="mobile-only"
	@click="layoutStore.close()"
/>

<!-- 不能用 Transition 实现弹出收起动画，因为半宽屏状态始终显示 -->
<aside id="blog-sidebar" :class="{ show: layoutStore.state === 'sidebar' }" :aria-label="t('site.siteSidebar')">
	<BlogHeader class="sidebar-header" to="/" />
	<BlogLiveDesk />

	<nav class="sidebar-nav scrollcheck-y" :aria-label="t('site.siteNavigation')">
		<button type="button" class="search-btn sidebar-nav-item gradient-card" @click="layoutStore.toggle('search')">
			<Icon name="tabler:search" />
			<span class="nav-text">{{ debouncedSelection || searchStore.word || t('common.search') }}</span>
			<Key class="keycut" code="K" cmd prevent @press="layoutStore.toggle('search')" />
		</button>

		<template v-for="(group, groupIndex) in navGroups" :key="groupIndex">
			<h3 v-if="group.title">
				{{ t(group.title) }}
			</h3>

			<menu>
				<li v-for="(item, itemIndex) in group.items" :key="itemIndex">
					<UtilLink :to="item.url" class="sidebar-nav-item">
						<Icon :name="item.icon" />
						<span class="nav-text">{{ t(item.text) }}</span>
						<Icon v-if="isExtLink(item.url)" class="external-tip" name="tabler:arrow-up-right" />
					</UtilLink>
				</li>
			</menu>
		</template>

		<menu v-if="pageLinks.length">
			<li v-for="page in pageLinks" :key="page.path">
				<UtilLink :to="page.path" class="sidebar-nav-item">
					<Icon name="tabler:file-text" />
					<span class="nav-text">{{ page.title }}</span>
				</UtilLink>
			</li>
		</menu>
	</nav>

	<footer class="sidebar-footer">
		<BlogReader />
		<BlogThemeToggle />
		<BlogUiLanguageSwitch />
		<ZIconNavList :list="iconNav" />
	</footer>
</aside>
</template>

<style lang="scss" scoped>
#blog-sidebar {
	display: flex;
	flex-direction: column;
	color: var(--c-text-2);

	&:hover {
		color: currentcolor;
	}

	@media (max-width: $breakpoint-mobile) {
		position: fixed;
		inset-inline-start: 0;
		width: 320px;
		max-width: 100%;
		background-color: var(--ld-bg-blur);
		backdrop-filter: blur(0.5rem);
		color: currentcolor;
		transform: var(--transform-start-far);
		transition: transform 0.2s;
		z-index: var(--z-index-popover);

		&.show {
			box-shadow: var(--box-shadow-1), var(--box-shadow-3);
			transform: none;
		}
	}
}

.sidebar-nav {
	flex-grow: 1;
	padding: 0 5%;
	font-size: 0.9em;

	h3 {
		margin: 2em 0 1em 1em;
		font: inherit;
		color: var(--c-text-2);
	}

	li {
		margin: 0.5em 0;
	}
}

.sidebar-nav-item {
	display: flex;
	align-items: center;
	gap: 0.5em;
	padding: 0.5em 1em;
	border-radius: 0.5em;
	transition: all 0.2s;

	&:hover,
	&.router-link-active {
		background-color: var(--c-bg-soft);
		color: var(--c-text);
	}

	&.router-link-active::after {
		content: "⦁";
		width: 1em;
		text-align: center;
		color: var(--c-text-3);
	}

	> .iconify {
		font-size: 1.5em;
	}

	> .nav-text {
		flex-grow: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	> .external-tip {
		opacity: 0.5;
		font-size: 1em;
	}
}

.search-btn {
	opacity: 0.5;
	// 原生按钮的默认样式去掉，外观与原先的 div 一致
	width: 100%;
	margin: 1rem 0;
	border: none;
	outline: 2px solid var(--c-border);
	outline-offset: -2px;
	background: none;
	font: inherit;
	text-align: start;
	color: inherit;
	cursor: text;
	user-select: none;

	&:hover {
		opacity: 1;
		outline-color: transparent;
		background-color: transparent;
	}
}

.sidebar-footer {
	--gap: clamp(0.5rem, 3vh, 1rem);

	display: grid;
	gap: var(--gap);
	padding: var(--gap);
	font-size: 0.8em;
	text-align: center;
	color: var(--c-text-2);
}
</style>
