/**
 * 界面语言、按 id 取文字、按浏览器语言跳转、标签译名与列表的译文标记
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { languagesOf, tagGlossaryOf, tagNamesOf } from '../../app/utils/mx/adapter'
import { tagNamesIn } from '../../shared/utils/article'
import { htmlLangOf, localeOf, msg, translate, uiLangOf, visitorNameText } from '../../shared/utils/i18n'
import { isContentDetailPath, localeRedirectOf, negotiateLang } from '../../shared/utils/lang'
import { formatNumber } from '../../shared/utils/str'
import { timeElapse } from '../../shared/utils/time'

describe('界面语言', () => {
	it('无前缀是中文，日文、韩文有自己的界面，其余前缀一律英文', () => {
		expect([undefined, 'en', 'ja', 'ko', 'fr', 'de'].map(uiLangOf)).toEqual(['zh', 'en', 'ja', 'ko', 'en', 'en'])
		expect(['zh', 'en', 'ja', 'ko'].map(lang => [localeOf(lang as never), htmlLangOf(lang as never)])).toEqual([['zh-CN', 'zh-CN'], ['en-US', 'en'], ['ja-JP', 'ja'], ['ko-KR', 'ko']])
	})

	it('按 id 取当前语言；服务端发来的中文按中文反查成 id 再取；查不到的原样返回', () => {
		expect(translate('zh', 'common.cancel')).toBe('取消')
		expect(translate('en', 'common.cancel')).toBe('Cancel')
		expect(translate(undefined, 'common.cancel')).toBe('取消')
		// msg() 在服务端取中文，页面上经 t() 反查
		expect(msg('common.pleaseSignFirst')).toBe('请先登录')
		expect(translate('en', msg('common.pleaseSignFirst'))).toBe('Please sign in first.')
		expect(translate('en', '站长自己写的导航名')).toBe('站长自己写的导航名')
		expect(translate('en', 'constructor')).toBe('constructor')
		expect(msg('no.suchId')).toBe('no.suchId')
	})

	it('占位与英文的单复数', () => {
		expect(translate('en', 'comment.replies', { n: 1 })).toBe('1 reply')
		expect(translate('en', 'comment.replies', { n: 3 })).toBe('3 replies')
		expect(translate('zh', 'comment.replies', { n: 3 })).toBe('3 条回复')
	})

	it('大数缩写与时长按界面语言', () => {
		expect([formatNumber(12_345), formatNumber(12_345, 'en'), formatNumber(12_345, 'ja'), formatNumber(12_345, 'ko'), formatNumber(999, 'en')]).toEqual(['1.23万', '12.3K', '1.2万', '1.2만', '999'])
		const since = '2020-01-01T00:00:00'
		expect(timeElapse(since, 'UTC', 1, 'ja')).toMatch(/^\d+年$/)
		expect(timeElapse(since, 'UTC', 1, 'ko')).toMatch(/^\d+년$/)
		expect(timeElapse(since, 'UTC', 1, 'en')).toMatch(/^\d+ years$/)
	})
})

describe('按浏览器语言跳转', () => {
	const enabled = ['en', 'ja']

	it('accept-Language 按 q 值挑站点有的第一个（中文也算）', () => {
		expect(negotiateLang('ja-JP,ja;q=0.9,en;q=0.8', enabled)).toBe('ja')
		expect(negotiateLang('fr-FR,fr;q=0.9,en;q=0.5', enabled)).toBe('en')
		expect(negotiateLang('en;q=0.5,zh-CN;q=0.9', enabled)).toBe('zh')
		expect(negotiateLang('de,fr', enabled)).toBeUndefined()
		expect(negotiateLang(undefined, enabled)).toBeUndefined()
		expect(negotiateLang('en;q=0', enabled)).toBeUndefined()
	})

	it('只跳无前缀的列表页：详情、看原文、爬虫、选过中文、首选中文都不跳；选过的语言优先于浏览器', () => {
		const base = { search: '', cookie: undefined, acceptLanguage: 'en-US,en;q=0.9', userAgent: 'Mozilla/5.0', enabled }
		expect(localeRedirectOf({ ...base, path: '/' })).toBe('/en')
		expect(localeRedirectOf({ ...base, path: '/archive', search: '?page=2' })).toBe('/en/archive?page=2')
		expect(localeRedirectOf({ ...base, path: '/says' })).toBe('/en/says')
		for (const path of ['/posts/tech/hello', '/notes/12', '/notes/2024/5/1/slug'])
			expect(localeRedirectOf({ ...base, path }), path).toBeUndefined()
		expect(localeRedirectOf({ ...base, path: '/', search: '?lang=original' })).toBeUndefined()
		expect(localeRedirectOf({ ...base, path: '/', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' })).toBeUndefined()
		expect(localeRedirectOf({ ...base, path: '/', cookie: 'zh' })).toBeUndefined()
		expect(localeRedirectOf({ ...base, path: '/', cookie: 'ja' })).toBe('/ja')
		expect(localeRedirectOf({ ...base, path: '/', cookie: 'fr' })).toBe('/en')
		expect(localeRedirectOf({ ...base, path: '/', acceptLanguage: 'zh-CN,en' })).toBeUndefined()
		expect(localeRedirectOf({ ...base, path: '/', enabled: [] })).toBeUndefined()
		expect(localeRedirectOf({ ...base, path: '/preview/token' })).toBeUndefined()
		expect(isContentDetailPath('/posts/tech')).toBe(false)
		// 标签页是列表，照常按浏览器语言跳
		expect(isContentDetailPath('/posts/tag/vue')).toBe(false)
		expect(isContentDetailPath('/posts/tech/hello')).toBe(true)
		expect(localeRedirectOf({ ...base, path: '/posts/tag/vue' })).toBe('/en/posts/tag/vue')
	})
})

describe('标签译名与列表的译文标记', () => {
	const meta = {
		glossary: { tags: [{ source: '前端', translated: 'Frontend' }, { source: '坏的', translated: '' }, { source: 1, translated: 'x' }, { source: '长', translated: 'x'.repeat(81) }] },
		translation: { 1: { article: { isTranslated: true, sourceLang: 'zh' } }, 2: { article: { isTranslated: false } } },
	}

	it('只收合格的译名；一篇只带用到的那些；整份列表合起来', () => {
		expect(tagGlossaryOf(meta)).toEqual({ 前端: 'Frontend' })
		expect(tagNamesOf(['前端', '后端'], tagGlossaryOf(meta))).toEqual({ 前端: 'Frontend' })
		expect(tagNamesOf(['后端'], tagGlossaryOf(meta))).toBeUndefined()
		expect(tagNamesIn([{ path: '/a', tagNames: { 前端: 'Frontend' } }, { path: '/b', tagNames: { 后端: 'Backend' } }, { path: '/c' }])).toEqual({ 前端: 'Frontend', 后端: 'Backend' })
		expect([languagesOf(meta, '1')?.translated, languagesOf(meta, '2')?.translated, languagesOf(meta, '3')]).toEqual([true, false, undefined])
	})
})

describe('访客自己填的名字', () => {
	it('只有占位「匿名」按界面语言显示；昵称填成界面文字的 id 或中文原句都原样显示，冒充不了「站长」', () => {
		expect(visitorNameText('en', msg('common.anonymous'))).toBe(translate('en', 'common.anonymous'))
		expect(visitorNameText('zh', msg('common.anonymous'))).toBe(msg('common.anonymous'))
		expect(translate('zh', 'common.owner')).not.toBe('common.owner')
		for (const name of ['common.owner', msg('common.owner'), 'comment.member', '小明'])
			expect([visitorNameText('zh', name), visitorNameText('en', name)], name).toEqual([name, name])
	})

	it('组件里不把访客的名字交给 t()：昵称会被当成界面文字的 id 去查', () => {
		const root = fileURLToPath(new URL('../../app', import.meta.url))
		const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : /\.(?:vue|ts)$/.test(entry.name) ? [join(dir, entry.name)] : [])
		const passesName = /\bt\(\s*[\w.?]*\.(?:author|nickname|displayName)\s*[,)]/
		const violations = walk(root).filter(path => passesName.test(readFileSync(path, 'utf8'))).map(path => relative(root, path))
		expect(violations).toEqual([])
	})
})
