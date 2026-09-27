/**
 * 内容的语言。站长在主题配置 `i18n.languages` 里开了哪些语言，每个页面就多一份 `/<语言>/...` 的前缀版：
 * 界面是英文（见 `i18n.ts`），文章、日记、独立页与列表的内容是 core 的 AI 译文（没有译文的显示原文）。纯函数。
 *
 * core 把语言代码一律折成两个字母（`packages/ai/src/lang.ts` 的 `normalizeLanguageCode`），分不出繁简中文，
 * 所以候选里没有 `zh-TW`。每个不同的 `lang` 值都是 core 的一个新缓存键：浏览器给的语言必须先过白名单
 */

/** 站点（界面与原文默认）的语言 */
export const SITE_LANG_CODE = 'zh'

/** 能开的语言；生效的是它与主题配置的交集 */
export const CANDIDATE_LANGS = ['en', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'pt', 'it'] as const

/** 看原文：core 的特殊值，不翻译、给原文（不用知道原文是什么语言） */
export const ORIGINAL_LANG = 'original'

const ALIASES: Record<string, string> = {
	'en-us': 'en',
	'en-gb': 'en',
	'en-au': 'en',
	'en-ca': 'en',
	'en-nz': 'en',
	'en-ie': 'en',
	'en-za': 'en',
	'zh-cn': 'zh',
	'zh-hans': 'zh',
	'zh-hant': 'zh',
	'zh-tw': 'zh',
	'cn': 'zh',
	'tw': 'zh',
	'jp': 'ja',
	'ja-jp': 'ja',
	'kr': 'ko',
	'ko-kr': 'ko',
	'pt-br': 'pt',
	'pt-pt': 'pt',
	'iw': 'he',
	'in': 'id',
	'nb': 'no',
	'nn': 'no',
}

const ISO_639_2: Record<string, string> = {
	eng: 'en',
	zho: 'zh',
	chi: 'zh',
	jpn: 'ja',
	kor: 'ko',
	fra: 'fr',
	fre: 'fr',
	deu: 'de',
	ger: 'de',
	spa: 'es',
	por: 'pt',
	rus: 'ru',
	ita: 'it',
	nld: 'nl',
	dut: 'nl',
	swe: 'sv',
	dan: 'da',
	fin: 'fi',
	nor: 'no',
}

/** 照 core 的规则折成两个字母（小写、`_` 换 `-`、别名表、三字母表、取主标签）；认不出是 undefined */
export function langCodeOf(value: unknown) {
	if (typeof value !== 'string' || value.length > 35)
		return undefined
	const normalized = value.trim().toLowerCase().replaceAll('_', '-')
	if (!normalized)
		return undefined
	const [base = ''] = normalized.split('-')
	const code = ALIASES[normalized] ?? (normalized.length === 2 ? normalized : normalized.length === 3 ? ISO_639_2[normalized] : base.length === 2 ? base : ISO_639_2[base])
	return code && /^[a-z]{2}$/.test(code) ? code : undefined
}

/** 主题配置里填的语言 → 生效的（候选 ∩ 配置，按候选的顺序，站点语言本身不算） */
export function enabledLangsOf(configured: unknown): string[] {
	const wanted = new Set((Array.isArray(configured) ? configured : []).map(langCodeOf))
	return CANDIDATE_LANGS.filter(lang => wanted.has(lang))
}

/** 请求的内容语言：折成两字母后在生效的语言里才算；站点语言、白名单外的一律 undefined（按站点语言取） */
export function contentLangOf(value: unknown, enabled: readonly string[]) {
	const code = langCodeOf(value)
	return code && code !== SITE_LANG_CODE && enabled.includes(code) ? code : undefined
}

/** 地址前缀里的语言：只看是不是候选（生效与否由路由中间件查主题配置） */
export function routeLangOf(value: unknown) {
	return typeof value === 'string' && (CANDIDATE_LANGS as readonly string[]).includes(value) ? value : undefined
}

/** 这些地址没有语言前缀版：不是页面（接口、订阅源、站点地图、静态资源、Skill 的附件）、草稿预览、转到别处的分类入口 */
const UNLOCALIZED = /^\/(?:preview|categories|api|feed|atom\.xml|sitemap|robots\.txt|llms|__|_nuxt|assets|images|favicon)(?:[/?#.]|$)|^\/(?:says|thinking)\/atom\.xml|^\/skills\/[^/?#]+\/[^?#]/
const PREFIXED = new RegExp(`^/(?:${CANDIDATE_LANGS.join('|')})(?:[/?#]|$)`)

/** 站内地址加上语言前缀；`lang` 为空、站外、已经有前缀、没有前缀版的地址原样返回 */
export function localePath(path: string, lang: string | undefined) {
	if (!lang || !path.startsWith('/') || path.startsWith('//') || PREFIXED.test(path) || UNLOCALIZED.test(path))
		return path
	return path === '/' || /^\/[?#]/.test(path) ? `/${lang}${path.slice(1)}` : `/${lang}${path}`
}

/** 去掉地址里的语言前缀 */
export function delocalizePath(path: string) {
	const match = path.match(PREFIXED)
	if (!match)
		return path
	const rest = path.slice(match[0].length - (/[/?#]$/.test(match[0]) ? 1 : 0))
	return rest.startsWith('/') ? rest : `/${rest}`
}

/** 语言代码在界面语言里的名字，如 `en` → 英语（`locale` 是 `en-US` 时是 English）；认不出就原样返回 */
export function languageName(code: string, locale = 'zh-CN') {
	try {
		return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
	}
	catch {
		return code
	}
}

/** 语言的本族语名，如 `en` → English、`ja` → 日本語（语言切换用） */
export function nativeLanguageName(code: string) {
	try {
		const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
		return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
	}
	catch {
		return code
	}
}

/** hreflang 用的语言标签：站点语言写成 zh-CN */
export function hreflangOf(code: string) {
	return code === SITE_LANG_CODE ? 'zh-CN' : code
}

/** 一篇内容的语言信息（与 `ContentLanguages` 同形） */
interface LanguagesLike {
	translated: boolean
	sourceLang?: string
	available: string[]
}

/** core 没给语言信息时按「不是译文、没有译文」处理（前缀版会跳回无前缀地址） */
export const UNTRANSLATED: Readonly<LanguagesLike> = Object.freeze({ translated: false, available: [] })

/** 一篇内容能看的语言版本：语言、地址、是不是原文 */
export interface LanguageVersion {
	lang: string
	path: string
	original: boolean
}

/**
 * 这一篇有哪些语言版本（语言切换、hreflang 共用）。`path` 是不带前缀的地址。
 * - 站点语言（无前缀地址）：原文就是站点语言、原文语言不知道（没有任何译文）、或者有站点语言的译文时才算；
 * - 有效译文 ∩ 开了的语言 → `/<语言>/...`；
 * - 原文语言：开了的走前缀，没开的走 `?lang=original`
 */
export function languageVersionsOf(path: string, languages: LanguagesLike | undefined, enabled: readonly string[]): LanguageVersion[] {
	if (!languages)
		return []
	const source = languages.sourceLang
	const versions = new Map<string, LanguageVersion>()
	if (!source || source === SITE_LANG_CODE || languages.available.includes(SITE_LANG_CODE))
		versions.set(SITE_LANG_CODE, { lang: SITE_LANG_CODE, path, original: !source || source === SITE_LANG_CODE })
	if (source && source !== SITE_LANG_CODE)
		versions.set(source, { lang: source, path: enabled.includes(source) ? localePath(path, source) : `${path}?lang=${ORIGINAL_LANG}`, original: true })
	for (const lang of CANDIDATE_LANGS) {
		if (enabled.includes(lang) && languages.available.includes(lang) && !versions.has(lang))
			versions.set(lang, { lang, path: localePath(path, lang), original: false })
	}
	return [...versions.values()]
}

/**
 * hreflang：只列能被收录的版本（`?lang=original` 的不算），少于两种不输出；
 * `x-default` 指向原文（原文语言没开时是站点语言那一份）
 */
export function hreflangLinksOf(versions: LanguageVersion[]) {
	const indexable = versions.filter(version => !version.path.includes('?'))
	if (indexable.length < 2)
		return []
	const fallback = indexable.find(version => version.original) ?? indexable.find(version => version.lang === SITE_LANG_CODE) ?? indexable[0]!
	return [...indexable.map(version => ({ hreflang: hreflangOf(version.lang), path: version.path })), { hreflang: 'x-default', path: fallback.path }]
}

// ———————————————————————————— 按浏览器语言自动跳转（与 Yohaku 一样） ————————————————————————————

/** 记住读者选的语言：进前缀版时写成那个语言，在语言切换里选中文时写 `zh`。有它就不再按浏览器语言猜 */
export const LANG_COOKIE = 'mx-lang'

/**
 * `Accept-Language`（或 `navigator.languages` 用逗号连起来）→ 读者最想要的、站点有的语言：
 * 按 q 值排序，逐个折成两字母，第一个是中文或在开了的语言里的就用它；都不是返回 undefined
 */
export function negotiateLang(accept: string | undefined, enabled: readonly string[]) {
	if (!accept || accept.length > 500)
		return undefined
	const ranked = accept.split(',').slice(0, 20).map((part, index) => {
		const [tag = '', ...params] = part.trim().split(';')
		const q = Number(params.find(param => param.trim().startsWith('q='))?.trim().slice(2) ?? 1)
		return { code: langCodeOf(tag), q: Number.isFinite(q) ? q : 0, index }
	}).filter(item => item.code && item.q > 0).sort((a, b) => b.q - a.q || a.index - b.index)
	return ranked.map(item => item.code!).find(code => code === SITE_LANG_CODE || enabled.includes(code))
}

/** 文章、日记的详情页：不按浏览器语言跳（搜索引擎收录的地址不随访问者变，与 Yohaku 一样）。`/posts/tag/<名>` 是标签页，不算 */
export function isContentDetailPath(path: string) {
	return /^\/posts\/(?!tag\/)[^/]+\/[^/]+\/?$/.test(path) || /^\/notes\/(?:\d+|\d{4}\/\d{1,2}\/\d{1,2}\/[^/]+)\/?$/.test(path)
}

const CRAWLER = /bot\b|crawler|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegram|discord|skype|lighthouse|chrome-lighthouse/i

interface RedirectInput {
	/** 不带前缀的地址（带前缀的不调这个） */
	path: string
	/** `?…`，原样接在跳转地址后面 */
	search: string
	cookie: string | undefined
	acceptLanguage: string | undefined
	userAgent: string | undefined
	enabled: readonly string[]
}

/**
 * 无前缀的页面要不要跳到某个语言的前缀版：多语言没开、详情页、看原文（`?lang=original`）、爬虫、
 * 读者选过中文、浏览器首选中文或站点没开的语言，都不跳；否则返回跳转地址
 */
export function localeRedirectOf({ path, search, cookie, acceptLanguage, userAgent, enabled }: RedirectInput) {
	if (!enabled.length || isContentDetailPath(path) || /(?:^|[?&])lang=/.test(search) || (userAgent && CRAWLER.test(userAgent)))
		return undefined
	const chosen = cookie === SITE_LANG_CODE || (cookie && enabled.includes(cookie)) ? cookie : undefined
	const wanted = chosen ?? negotiateLang(acceptLanguage, enabled)
	if (!wanted || wanted === SITE_LANG_CODE)
		return undefined
	const target = localePath(path, wanted)
	return target === path ? undefined : `${target}${search}`
}
