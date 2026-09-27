/**
 * 多语言：语言代码、白名单、前缀地址、语言版本与 hreflang、主题配置、详情的语言信息
 */
import { describe, expect, it } from 'vitest'
import { languagesOf, translationOf } from '../../app/utils/mx/adapter'
import { themeConfigFrom } from '../../app/utils/mx/theme'
import { delocalizePath, enabledLangsOf, hreflangLinksOf, langCodeOf, languageVersionsOf, localePath, nativeLanguageName, routeLangOf } from '../../shared/utils/lang'

describe('语言代码', () => {
	it('照 core 的 normalizeLanguageCode：别名、三字母、取主标签；认不出是 undefined', () => {
		const cases: [unknown, string | undefined][] = [['en', 'en'], ['EN_us', 'en'], ['zh-Hant', 'zh'], ['tw', 'zh'], ['jpn', 'ja'], ['pt-BR', 'pt'], ['fr-CA', 'fr'], ['iw', 'he'], ['xyz', undefined], ['english', undefined], ['', undefined], [undefined, undefined], ['e1', undefined]]
		for (const [input, expected] of cases)
			expect(langCodeOf(input), String(input)).toBe(expected)
	})

	it('生效的语言 = 候选 ∩ 配置，按候选的顺序；站点语言、繁体、不在候选里的丢掉', () => {
		expect(enabledLangsOf(['ja', 'EN', 'zh', 'zh-TW', 'vi', 'ja'])).toEqual(['en', 'ja'])
		expect(enabledLangsOf('en')).toEqual([])
	})

	it('地址前缀只认候选', () => {
		expect(routeLangOf('en')).toBe('en')
		for (const bad of ['zh', 'EN', 'xx', undefined, ['en']])
			expect(routeLangOf(bad), String(bad)).toBeUndefined()
	})
})

describe('前缀地址', () => {
	it('站内页面都加前缀（说说、友链这些内容不翻译的页面也有英文界面版）；站外、已有前缀、接口与订阅源、Skill 附件、草稿预览原样', () => {
		expect(localePath('/', 'en')).toBe('/en')
		expect(localePath('/?category=x', 'en')).toBe('/en?category=x')
		expect(localePath('/posts/tech/a', 'en')).toBe('/en/posts/tech/a')
		expect(localePath('/notes/3#comments', 'ja')).toBe('/ja/notes/3#comments')
		expect(localePath('/about', 'en')).toBe('/en/about')
		for (const page of ['/says', '/thinking/1', '/link', '/membership', '/search?q=x', '/skills/demo'])
			expect(localePath(page, 'en'), page).toBe(`/en${page}`)
		for (const kept of ['/atom.xml', '/says/atom.xml', '/thinking/atom.xml', '/skills/demo/SKILL.md', '/preview/token', '/api/mx/posts', '/en/posts/a/b', 'https://example.test/', '//evil.test/x', '#top', '/categories/tech'])
			expect(localePath(kept, 'en'), kept).toBe(kept)
		expect(localePath('/posts/tech/a', undefined)).toBe('/posts/tech/a')
	})

	it('去掉前缀', () => {
		expect(delocalizePath('/en')).toBe('/')
		expect(delocalizePath('/en/posts/a/b')).toBe('/posts/a/b')
		expect(delocalizePath('/en?x=1')).toBe('/?x=1')
		expect(delocalizePath('/english/x')).toBe('/english/x')
		expect(delocalizePath('/posts/a')).toBe('/posts/a')
	})

	it('本族语名', () => {
		expect(nativeLanguageName('en')).toBe('English')
		expect(nativeLanguageName('ja')).toBe('日本語')
	})
})

describe('语言版本与 hreflang', () => {
	const PATH = '/posts/tech/a'

	it('中文原文、有英日译文、只开了英语：中文、英语两个版本；x-default 指向原文', () => {
		const versions = languageVersionsOf(PATH, { translated: false, sourceLang: 'zh', available: ['en', 'ja'] }, ['en'])
		expect(versions).toEqual([{ lang: 'zh', path: PATH, original: true }, { lang: 'en', path: '/en/posts/tech/a', original: false }])
		expect(hreflangLinksOf(versions)).toEqual([
			{ hreflang: 'zh-CN', path: PATH },
			{ hreflang: 'en', path: '/en/posts/tech/a' },
			{ hreflang: 'x-default', path: PATH },
		])
	})

	it('英文原文、有中文译文：原文语言开了走前缀，没开走 ?lang=original（不进 hreflang）', () => {
		const info = { translated: true, sourceLang: 'en', available: ['zh'] }
		expect(languageVersionsOf(PATH, info, ['en'])).toEqual([{ lang: 'zh', path: PATH, original: false }, { lang: 'en', path: '/en/posts/tech/a', original: true }])
		expect(hreflangLinksOf(languageVersionsOf(PATH, info, ['en'])).at(-1)).toEqual({ hreflang: 'x-default', path: '/en/posts/tech/a' })
		const closed = languageVersionsOf(PATH, info, [])
		expect(closed).toEqual([{ lang: 'zh', path: PATH, original: false }, { lang: 'en', path: `${PATH}?lang=original`, original: true }])
		expect(hreflangLinksOf(closed)).toEqual([])
	})

	it('没有任何译文：只有一个版本，不出 hreflang；没有语言信息时什么都没有', () => {
		expect(languageVersionsOf(PATH, { translated: false, available: [] }, ['en'])).toEqual([{ lang: 'zh', path: PATH, original: true }])
		expect(hreflangLinksOf(languageVersionsOf(PATH, { translated: false, available: [] }, ['en']))).toEqual([])
		expect(languageVersionsOf(PATH, undefined, ['en'])).toEqual([])
	})

	it('没开的语言即使有译文也不列', () => {
		expect(languageVersionsOf(PATH, { translated: false, sourceLang: 'zh', available: ['ja', 'ko'] }, ['en']).map(v => v.lang)).toEqual(['zh'])
	})
})

describe('配置与详情', () => {
	it('主题配置 i18n.languages：默认空（关闭），只收候选并给出提示', () => {
		expect(themeConfigFrom({}).config.i18n).toEqual({ languages: [] })
		const { config, warnings } = themeConfigFrom({ i18n: { languages: ['ja', 'en', 'zh-TW'] } })
		expect(config.i18n.languages).toEqual(['en', 'ja'])
		expect(warnings.some(w => w.includes('i18n.languages'))).toBe(true)
	})

	it('$meta.translation → 语言信息：可用译文折成两字母去重，认不出的丢掉', () => {
		const meta = { translation: { 1: { article: { isTranslated: true, sourceLang: 'zh-CN', availableTranslations: ['en', 'EN-us', 'ja', '<b>'] } } } }
		expect(languagesOf(meta, '1')).toEqual({ translated: true, sourceLang: 'zh', available: ['en', 'ja'] })
		expect(languagesOf(meta, '2')).toBeUndefined()
		expect(languagesOf({ translation: { 1: { article: { isTranslated: false, sourceLang: null } } } }, '1')).toEqual({ translated: false, available: [] })
		// 原文是站点语言时「从什么语言译成中文」的提示不出现
		expect(translationOf(meta, '1')).toBeUndefined()
	})
})
