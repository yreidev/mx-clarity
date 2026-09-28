<script setup lang="ts">
import type { ContentLanguages } from '~/types/article'

/**
 * AI 译文的说明：正文是译文时说明从什么语言译成什么语言、给出看原文的入口；正在看原文时给出回到站点语言的入口；
 * 前缀版里这一篇还没有这一语言的译文时，说明下面是原文。
 * 这一篇的译文在实时推送里更新了，提示一句、给个重新加载的按钮
 */
const props = defineProps<{
	languages?: ContentLanguages
	/** 正在看原文（`?lang=original`） */
	original?: boolean
	/** 这篇在 core 里的 id（认实时推送用） */
	refId?: string
}>()

const emit = defineEmits<{
	refresh: []
}>()

const route = useRoute()
const lang = useRouteLang()
const t = useT()
const locale = useUiLocale()
const nameOf = (code: string) => languageName(code, locale.value)
const { data: theme } = useMxTheme()
const path = computed(() => delocalizePath(route.path))
const target = computed(() => lang.value ?? SITE_LANG_CODE)
const source = computed(() => props.languages?.sourceLang)
const translated = computed(() => Boolean(props.languages?.translated && !props.original))
const originalText = computed(() => (source.value ? t('post.youreReadingTheOriginal', { language: nameOf(source.value) }) : t('post.youreReadingOriginal')))
/** 前缀版里没有这一语言的译文，正文是原文 */
const untranslated = computed(() => Boolean(lang.value && props.languages && !props.languages.translated && source.value !== lang.value))

/** 看原文：原文语言开了前缀版就去那里，原文是站点语言就是无前缀地址，其余用 `?lang=original` */
const originalHref = computed(() => {
	if (source.value === SITE_LANG_CODE)
		return path.value
	if (source.value && theme.value.i18n.languages.includes(source.value))
		return localePath(path.value, source.value)
	return `${path.value}?lang=${ORIGINAL_LANG}`
})

const updated = ref(false)
useLiveMessages((message) => {
	if (message.type === 'translation' && message.refId === props.refId && translated.value && message.lang === target.value)
		updated.value = true
})

function reload() {
	updated.value = false
	emit('refresh')
}
</script>

<template>
<p v-if="original" class="translation-notice" role="note">
	<Icon name="tabler:language" />
	{{ originalText }}
	<NuxtLink :to="path">
		{{ t('post.readIn', { language: nameOf(SITE_LANG_CODE) }) }}
	</NuxtLink>
</p>
<p v-else-if="untranslated" class="translation-notice" role="note">
	<Icon name="tabler:language" />
	{{ t('post.hasntBeenTranslated', { language: nameOf(target), source: nameOf(source ?? SITE_LANG_CODE) }) }}
</p>
<p v-else-if="translated && (lang || (source && source !== SITE_LANG_CODE))" class="translation-notice" role="note">
	<Icon name="tabler:language" />
	{{ t('post.translatedAi', { source: source ? nameOf(source) : t('post.originalLanguage'), target: nameOf(target) }) }}
	<NuxtLink :to="originalHref">
		{{ t('post.readOriginal') }}
	</NuxtLink>
	<template v-if="updated">
		· {{ t('post.translationHasBeen') }}<button type="button" @click="reload">
			{{ t('post.reload') }}
		</button>
	</template>
</p>
</template>

<style scoped>
.translation-notice {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.3em;
	margin: 0.5rem 1.5rem 0;
	padding: 0.5em 0.8em;
	border-radius: 0.5em;
	background-color: var(--c-bg-2);
	font-size: 0.85em;
	color: var(--c-text-2);

	a, button {
		color: var(--c-primary);

		&:hover {
			text-decoration: underline;
		}
	}
}
</style>
