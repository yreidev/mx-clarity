/**
 * 匿名访客的整页缓存：哪些请求能走缓存、缓存键怎么算、存哪些响应头、按条数与大小淘汰
 */
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createPageStore, isStorablePage, pageCacheKeyOf, storableHeadersOf, withOwnCacheControl } from '../../server/utils/page-cache'

const base = { method: 'GET', path: '/', search: '', host: 'blog.example.com', accept: 'text/html,application/xhtml+xml', cookie: undefined }

describe('哪些请求走缓存', () => {
	it('匿名的页面请求走缓存，键是 Host + 路径 + 排好序的查询参数', () => {
		expect(pageCacheKeyOf(base)).toBe('blog.example.com/')
		expect(pageCacheKeyOf({ ...base, method: 'HEAD', path: '/archive' })).toBe('blog.example.com/archive')
		expect(pageCacheKeyOf({ ...base, path: '/timeline', search: '?view=dense&type=post' })).toBe('blog.example.com/timeline?type=post&view=dense')
		expect(pageCacheKeyOf({ ...base, path: '/en/posts/tech/hello', search: '?lang=original' })).toBe('blog.example.com/en/posts/tech/hello?lang=original')
		// 与登录无关的 cookie（语言选择、统计）不影响
		expect(pageCacheKeyOf({ ...base, cookie: 'mx-lang=en; _ga=1' })).toBe('blog.example.com/')
	})

	it('不走缓存：写请求、不要 HTML、接口与静态文件、搜索与草稿预览、带登录 cookie、带了别的查询参数、键太长', () => {
		expect(pageCacheKeyOf({ ...base, method: 'POST' })).toBeUndefined()
		expect(pageCacheKeyOf({ ...base, accept: 'application/json' })).toBeUndefined()
		for (const path of ['/api/mx/posts', '/_nuxt/entry.js', '/__nuxt_error', '/_ipx/w_100/a.png', '/favicon.svg', '/atom.xml', '/search', '/en/search', '/preview/token'])
			expect(pageCacheKeyOf({ ...base, path }), path).toBeUndefined()
		expect(pageCacheKeyOf({ ...base, cookie: '__Secure-better-auth.session_token=abc' })).toBeUndefined()
		expect(pageCacheKeyOf({ ...base, cookie: 'better-auth.session_token=abc' })).toBeUndefined()
		for (const search of ['?peek-to=/posts/a', '?status=success', '?page=2&utm_source=x'])
			expect(pageCacheKeyOf({ ...base, search }), search).toBeUndefined()
		expect(pageCacheKeyOf({ ...base, path: `/${'a'.repeat(600)}` })).toBeUndefined()
	})
})

describe('存什么', () => {
	it('只存能共用的响应头：去掉 cookie、策略头、日期与长度', () => {
		expect(storableHeadersOf({
			'Content-Type': 'text/html;charset=utf-8',
			'Vary': 'Accept-Language, Cookie',
			'set-cookie': ['mx-lang=en'],
			'content-security-policy': 'x',
			'Content-Length': '10',
			'x-powered-by': 'Nuxt',
			'link': ['</a.css>; rel=preload', '</b.css>; rel=preload'],
		})).toEqual({ 'content-type': 'text/html;charset=utf-8', 'vary': 'Accept-Language, Cookie', 'link': '</a.css>; rel=preload, </b.css>; rel=preload' })
	})

	it('只存 200 的 HTML，标了 private / no-store 的不存', () => {
		expect(isStorablePage(200, { 'content-type': 'text/html;charset=utf-8' })).toBe(true)
		expect(isStorablePage(undefined, { 'content-type': 'text/html' })).toBe(true)
		expect(isStorablePage(404, { 'content-type': 'text/html' })).toBe(false)
		expect(isStorablePage(200, { 'content-type': 'application/json' })).toBe(false)
		expect(isStorablePage(200, { 'content-type': 'text/html', 'cache-control': 'private, no-store' })).toBe(false)
	})

	it('页面自己设在请求上的 cache-control 也算（付费文章的 private, no-store 不在渲染器的响应头里）', () => {
		const rendered = { 'content-type': 'text/html;charset=utf-8' }
		expect(isStorablePage(200, withOwnCacheControl(rendered, 'private, no-store'))).toBe(false)
		expect(isStorablePage(200, withOwnCacheControl(rendered, ['no-store']))).toBe(false)
		expect(isStorablePage(200, withOwnCacheControl(rendered, undefined))).toBe(true)
		expect(isStorablePage(200, withOwnCacheControl({ ...rendered, 'cache-control': 'max-age=60' }, 'private'))).toBe(false)
		expect(withOwnCacheControl(rendered, undefined)).toBe(rendered)
	})
})

describe('缓存本身', () => {
	const page = (body: string, storedAt = 0) => ({ body, headers: {}, storedAt })

	it('过期就不给并删掉；取到的挪到最近用过，满了先淘汰最久没用的', () => {
		const store = createPageStore({ maxEntries: 2, maxBytes: 1000 })
		store.set('a', page('A', 0))
		expect(store.get('a', 599_999, 600_000)?.body).toBe('A')
		expect(store.get('a', 600_000, 600_000)).toBeUndefined()
		expect(store.size).toBe(0)
		store.set('a', page('A'))
		store.set('b', page('B'))
		store.get('a', 1, 600_000)
		store.set('c', page('C'))
		expect([store.get('a', 1, 600_000)?.body, store.get('b', 1, 600_000), store.get('c', 1, 600_000)?.body]).toEqual(['A', undefined, 'C'])
	})

	it('按总大小淘汰；单页比上限还大的不存；清空', () => {
		const store = createPageStore({ maxEntries: 10, maxBytes: 10 })
		store.set('a', page('aaaa'))
		store.set('b', page('bbbb'))
		store.set('c', page('cccc'))
		expect([store.get('a', 1, 10_000), store.get('b', 1, 10_000)?.body, store.get('c', 1, 10_000)?.body]).toEqual([undefined, 'bbbb', 'cccc'])
		store.set('huge', page('x'.repeat(11)))
		expect(store.get('huge', 1, 10_000)).toBeUndefined()
		store.clear()
		expect(store.size).toBe(0)
	})
})

describe('中间件的执行顺序', () => {
	it('按文件名排（Nitro 的规则）：请求体上限 → 旧链接跳转 → 预览参数跳转 → 按浏览器语言跳转 → 整页缓存（缓存命中也先走跳转；旧链接先于语言前缀）', () => {
		const dir = fileURLToPath(new URL('../../server/middleware', import.meta.url))
		const names = readdirSync(dir).filter(name => name.endsWith('.ts')).sort((a, b) => a.localeCompare(b))
		expect(names).toEqual(['1.body-limit.ts', '2.redirects.ts', '3.peek-to.ts', '4.locale-redirect.ts', '5.page-cache.ts'])
	})
})
