<script setup lang="ts">
import type { UiLang } from '~~/shared/utils/i18n'

/**
 * 全站的界面语言切换（侧栏底部，深浅色切换旁）：中文，以及站点开了前缀版、又有界面文字的英文、日文、韩文。
 * 去同一页的另一种界面；点的时候记下 cookie `mx-lang`，之后不带前缀来访就按它（选中文就不再按浏览器语言跳）。
 * 文章页里「其他语言版本」照旧，那是内容的语言
 */
const t = useT()
const route = useRoute()
const current = useUiLang()
const { data: theme } = useMxTheme()
const cookie = useCookie<string | undefined>(LANG_COOKIE, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

const options = computed(() => {
	const path = delocalizePath(route.fullPath)
	const enabled = theme.value.i18n.languages
	return UI_LANGS
		.filter(lang => lang === 'zh' || enabled.includes(lang))
		// 语言名用各自的写法（中文、English、日本語、한국어）
		.map(lang => ({ lang, name: nativeLanguageName(lang), to: lang === 'zh' ? path : localePath(path, lang) }))
})

function remember(lang: UiLang) {
	cookie.value = lang
}
</script>

<template>
<nav v-if="options.length > 1" class="ui-language-switch" :aria-label="t('site.interfaceLanguage')">
	<NuxtLink
		v-for="option in options"
		:key="option.lang"
		:to="option.to"
		:lang="htmlLangOf(option.lang)"
		:hreflang="htmlLangOf(option.lang)"
		:class="{ active: option.lang === current }"
		:aria-current="option.lang === current ? 'true' : undefined"
		@click="remember(option.lang)"
	>
		{{ option.name }}
	</NuxtLink>
</nav>
</template>

<style scoped>
.ui-language-switch {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 3px;
	width: fit-content;
	margin: 0 auto;
	padding: 2px;
	border: 1px solid var(--c-border);
	border-radius: 1rem;
	background-color: var(--c-bg-2);

	> a {
		padding: 2px 0.7rem;
		border-radius: 1rem;
		transition: all 0.1s;

		&:hover {
			background-color: var(--c-bg-soft);
			color: var(--c-text-1);
		}

		&.active {
			box-shadow: var(--box-shadow-2);
			background-color: var(--ld-bg-card);
			color: var(--c-text-1);
		}
	}
}
</style>
