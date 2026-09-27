import type { ContentLanguages } from '~/types/article'

/**
 * 内容语言：地址前缀里的语言（`/en/...`）。候选之外的前缀路由匹配不上，开没开由 `middleware/content-lang.global.ts` 查。
 * 取数的组合函数都经它带上 `?lang=`，数据的 key 也按它分开；没有前缀是 undefined（站点语言）
 */
export function useRouteLang() {
	const route = useRoute()
	return computed(() => routeLangOf(route.params.lang))
}

/** 站内地址加上当前的语言前缀（`UtilLink` 用它，读者点进别的页面时语言不丢） */
export function useLocalePath() {
	const lang = useRouteLang()
	return (path: string) => localePath(path, lang.value)
}

/** 取数用的 key：站点语言不变，其它语言加后缀 */
export function langKeyOf(key: string, lang: string | undefined) {
	return lang ? `${key}@${lang}` : key
}

/**
 * 详情页（文章、日记、独立页）的多语言：
 * - 前缀版拿不到这一语言的译文（core 回 `isTranslated: false`，也不是原文语言）：留在前缀地址（读者一路是英文界面），
 *   正文是原文，`noindex`，canonical 指向无前缀的原文地址；页面上的说明由 `TranslationNotice` 给；
 * - 输出 hreflang（各版本的绝对地址，少于两种不输出）；有译文时 canonical 由 nuxt-seo-utils 按当前地址给，各版本指向自己；
 * - 给出正文实际的语言（`lang` 属性用；站点语言时是 undefined）
 */
export async function useLocalizedDetail(languages: MaybeRefOrGetter<ContentLanguages | null | undefined>, original: MaybeRefOrGetter<boolean>) {
	const route = useRoute()
	const lang = useRouteLang()
	const { data: theme } = useMxTheme()
	const path = computed(() => delocalizePath(route.path))
	const versions = computed(() => languageVersionsOf(path.value, toValue(languages) ?? undefined, theme.value.i18n.languages))
	const base = (useSiteConfig().url || useRequestURL().origin).replace(/\/+$/, '')
	useHead({
		link: () => hreflangLinksOf(versions.value).map(link => ({ rel: 'alternate', hreflang: link.hreflang, href: `${base}${link.path}` })),
	})

	/** 前缀版里没有这一语言的译文，显示的是原文 */
	const untranslated = computed(() => {
		const info = toValue(languages)
		return Boolean(lang.value && info && !info.translated && info.sourceLang !== lang.value)
	})
	useHead(() => untranslated.value
		? { meta: [{ name: 'robots', content: 'noindex, follow' }], link: [{ rel: 'canonical', href: `${base}${path.value}`, key: 'canonical' }] }
		: {})

	const shownLang = computed(() => {
		const info = toValue(languages)
		if (untranslated.value)
			return info?.sourceLang ?? SITE_LANG_CODE
		if (lang.value)
			return lang.value
		if (toValue(original))
			return info?.sourceLang
		return info && !info.translated && info.sourceLang && info.sourceLang !== SITE_LANG_CODE ? info.sourceLang : undefined
	})
	return { versions, shownLang, path, untranslated }
}
