import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { thinkingFields } from '../../app/utils/mx/adapter'
import { loadPageLinks, RESERVED_PAGE_SLUGS } from '../../app/utils/mx/pages'
import { snowflakeOf } from '../../server/utils/mx-query'
import { articleRedirectOf, articlesWithTag, categoryNameOf, tagPath } from '../../shared/utils/article'
import { clientWith, fixture, jsonResponse } from './helpers'

const articles = [
	{ path: '/posts/tools/a', categories: ['工具'], tags: ['示例', '网络'] },
	{ path: '/posts/essay/b', categories: ['随笔'], tags: ['书架'] },
	{ path: '/posts/tools-extra/c', categories: ['别的'], tags: ['网络'] },
]

describe('分类与标签', () => {
	it('分类 slug 从文章地址里认，换成分类名；前缀相同的别的分类不算', () => {
		expect(categoryNameOf(articles, 'tools')).toBe('工具')
		expect(categoryNameOf(articles, 'essay')).toBe('随笔')
		expect(categoryNameOf(articles, 'tool')).toBeUndefined()
		expect(categoryNameOf([], 'tools')).toBeUndefined()
	})

	it('按标签筛，顺序不变；标签地址整段编码', () => {
		expect(articlesWithTag(articles, '网络').map(a => a.path)).toEqual(['/posts/tools/a', '/posts/tools-extra/c'])
		expect(articlesWithTag(articles, '没有')).toEqual([])
		expect(tagPath('C/C++ 笔记')).toBe('/posts/tag/C%2FC%2B%2B%20%E7%AC%94%E8%AE%B0')
	})
})

describe('改过 slug 的文章', () => {
	it('当前地址与文章的真实地址不同才跳；编码不同、末尾斜杠不算不同', () => {
		expect(articleRedirectOf('/posts/tools/old-slug', '/posts/tools/new-slug')).toBe('/posts/tools/new-slug')
		expect(articleRedirectOf('/posts/old-category/a', '/posts/tools/a')).toBe('/posts/tools/a')
		expect(articleRedirectOf('/posts/tools/a', '/posts/tools/a')).toBeUndefined()
		expect(articleRedirectOf('/posts/tools/a/', '/posts/tools/a')).toBeUndefined()
		expect(articleRedirectOf('/posts/%E7%AC%94%E8%AE%B0/a', '/posts/笔记/a')).toBeUndefined()
		expect(articleRedirectOf('/posts/tools/a', undefined)).toBeUndefined()
	})
})

describe('独立页进导航', () => {
	it('夹具（正文截短）：按 order 排，与静态路由同名的 link 跳过', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('pages-list')))
		expect(await loadPageLinks(client)).toEqual([
			{ title: '关于', path: '/about' },
			{ title: 'Lexical 独立页', path: '/lexical-page' },
		])
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/pages')
	})

	it('顺序以 order 为准，不看接口给的先后', async () => {
		const data = fixture('pages-list')
		data.data.reverse()
		const { client } = clientWith(() => jsonResponse(data))
		expect((await loadPageLinks(client)).map(p => p.path)).toEqual(['/about', '/lexical-page'])
	})

	it('保留字覆盖 app/pages 下的每个一级静态路由', () => {
		const pages = readdirSync(new URL('../../app/pages', import.meta.url))
			.filter(name => !name.startsWith('[') && name !== 'index.vue')
			.map(name => name.replace(/\.vue$/, ''))
		expect(pages.length).toBeGreaterThan(5)
		for (const name of pages)
			expect(RESERVED_PAGE_SLUGS.has(name), name).toBe(true)
		// routeRules 里的分类入口；语言前缀（`/en` 是英文首页）
		expect(RESERVED_PAGE_SLUGS.has('categories')).toBe(true)
		expect(RESERVED_PAGE_SLUGS.has('en')).toBe(true)
	})
})

describe('碎碎念评论', () => {
	it('只有明确关掉才不给评论区', async () => {
		const item = fixture('recently-item')
		const { client } = clientWith(() => jsonResponse(item))
		expect(thinkingFields(await client.recently.getById('1')).allowComment).toBe(true)
		item.data.allow_comment = false
		const closed = clientWith(() => jsonResponse(item))
		expect(thinkingFields(await closed.client.recently.getById('1')).allowComment).toBe(false)
		delete item.data.allow_comment
		const missing = clientWith(() => jsonResponse(item))
		expect(thinkingFields(await missing.client.recently.getById('1')).allowComment).toBe(true)
	})
})

describe('路由参数：Snowflake id', () => {
	it('与 core 的校验一致：不以 0 开头、最多 19 位、不超过 int64，其余一律当作不存在', () => {
		expect(snowflakeOf('12345')).toBe('12345')
		expect(snowflakeOf('9223372036854775807')).toBe('9223372036854775807')
		for (const bad of ['0', '012', '9223372036854775808', '12345678901234567890', 'abc', '', undefined, 123])
			expect(snowflakeOf(bad), String(bad)).toBeUndefined()
	})
})
