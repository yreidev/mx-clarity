<script setup lang="ts">
import type { LanguageVersion } from '~~/shared/utils/lang'

/**
 * 文章、日记头部的语言切换：「原文 + 可用译文」有两种以上时出现，语言名用各自的本族语写（English、日本語）。
 * 链接是算好的各版本地址，不再经 UtilLink 加前缀
 */
const props = defineProps<{
	versions: LanguageVersion[]
	/** 正在看的语言（站点语言时是 undefined） */
	current?: string
}>()

const t = useT()
const shown = computed(() => props.current ?? SITE_LANG_CODE)
const labelOf = (version: LanguageVersion) => version.original ? t('post.original', { language: nativeLanguageName(version.lang) }) : nativeLanguageName(version.lang)
</script>

<template>
<nav v-if="versions.length >= 2" class="language-switch" :aria-label="t('common.language')">
	<Icon name="tabler:language" />
	<template v-for="version in versions" :key="version.lang">
		<span v-if="version.lang === shown" class="current" aria-current="true" :lang="version.lang">
			{{ labelOf(version) }}
		</span>
		<NuxtLink v-else :to="version.path" :lang="version.lang" :hreflang="hreflangOf(version.lang)">
			{{ labelOf(version) }}
		</NuxtLink>
	</template>
</nav>
</template>

<style lang="scss" scoped>
.language-switch {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3em 0.8em;
	margin: 0.5rem 1.5rem 0;
	font-size: 0.85em;
	color: var(--c-text-2);

	a:hover {
		color: var(--c-primary);
	}

	.current {
		font-weight: 600;
		color: var(--c-text);
	}
}
</style>
