import { describe, expect, it } from 'vitest'
import { mxPostKey } from '../../app/composables/useMxPosts'
import { articleFromPost, readingTimeOf, resolveArticleType, safeUrl, translationOf } from '../../app/utils/mx/adapter'
import { loadAllArticles, POST_PAGE_SIZE } from '../../app/utils/mx/posts'
import blogConfig from '../../blog.config'
import { adjacentArticles, articleKeywordsOf, keywordsText } from '../../shared/utils/article'
import { contentLangOf, languageName } from '../../shared/utils/lang'
import { clientWith, fixture, jsonResponse } from './helpers'

/** 用详情夹具走一遍 api-client，拿到 camelCase 之后的 PostModel */
async function postFrom(name: string) {
	const { client } = clientWith(() => jsonResponse(fixture(name)))
	return client.post.getPost('x', 'y')
}

describe('文章：PostModel → ArticleProps', () => {
	it('lexical 文章的各字段', async () => {
		const post = await postFrom('post-lexical-lists')
		const article = articleFromPost(post)
		expect(article).toMatchObject({
			title: '示例：列表里的代码块',
			date: '2022-02-16T06:30:00.000Z',
			published: '2022-02-16T06:30:00.000Z',
			categories: ['工具'],
			path: '/posts/tools/sample-list-code',
			draft: false,
			permalink: undefined,
			type: 'tech',
		})
		expect(article.description).toMatch(/^这篇示例文章演示/)
		expect(article.tags).toContain('列表')
		expect(article.updated).toBe(post.modifiedAt)
		expect(article.meta?.__id).toBe(post.id)
		expect(article.readingTime?.words).toBeGreaterThan(0)
	})

	it('没有封面、没有置顶时对应字段为 undefined，不是 null', async () => {
		const article = articleFromPost(await postFrom('post-lexical-lists'))
		expect(article.image).toBeUndefined()
		expect(article.recommend).toBeUndefined()
		expect(article.meta?.__image).toBeUndefined()
	})

	it('封面取 meta.cover（admin 设置面板写入的位置），并从 images 里带上它的尺寸', async () => {
		const post = await postFrom('post-lexical-lists')
		post.meta = { cover: 'https://img.test/a.png' }
		post.images = [
			{ src: 'https://img.test/body.png', width: 10, height: 10, type: 'png' },
			{ src: 'https://img.test/a.png', width: 1200, height: 630, type: 'png', accent: '#123456' },
		]
		const article = articleFromPost(post)
		expect(article.image).toBe('https://img.test/a.png')
		expect(article.meta?.__image).toMatchObject({ width: 1200, height: 630, accent: '#123456' })
	})

	it('封面与参考链接过协议白名单', async () => {
		const post = await postFrom('post-lexical-lists')
		post.meta = {
			cover: 'javascript:alert(1)',
			references: [{ title: '正常', link: 'https://example.com' }, { title: '恶意', link: 'javascript:alert(1)' }, 'garbage'],
		}
		const article = articleFromPost(post)
		expect(article.image).toBeUndefined()
		expect(article.references).toEqual([
			{ title: '正常', link: 'https://example.com' },
			{ title: '恶意', link: undefined },
		])
	})

	it('置顶文章：recommend 取 pinOrder，缺省为 1', async () => {
		const post = await postFrom('post-lexical-lists')
		post.pinAt = '2026-01-01T00:00:00.000Z'
		expect(articleFromPost(post).recommend).toBe(1)
		post.pinOrder = 5
		expect(articleFromPost(post).recommend).toBe(5)
	})

	it('meta 其余字段原样透传（aside、hideInfo 等）', async () => {
		const post = await postFrom('post-lexical-lists')
		post.meta = { aside: ['toc'], hideInfo: true }
		expect(articleFromPost(post).meta).toMatchObject({ aside: ['toc'], hideInfo: true })
	})
})

describe('type 的取值优先级', () => {
	const allowed = Object.keys(blogConfig.article.types)
	it('meta.type 优先', () => {
		expect(resolveArticleType('story', '技术', [{ 技术: 'tech' }], allowed)).toBe('story')
	})
	it('其次 snippet 的分类映射，再其次 app.config 的', () => {
		expect(resolveArticleType(undefined, '随笔', [{ 随笔: 'story' }, { 随笔: 'tech' }], allowed)).toBe('story')
		expect(resolveArticleType(undefined, '随笔', [undefined, { 随笔: 'story' }], allowed)).toBe('story')
	})
	it('都没有时取第一个可用类型；不认识的值视为没取到', () => {
		expect(resolveArticleType(undefined, '随笔', [], allowed)).toBe(allowed[0])
		expect(resolveArticleType('poem', '随笔', [{ 随笔: 'novel' }], allowed)).toBe(allowed[0])
	})
	it('夹具：mx-syntax-sample 的 meta.type = tech', async () => {
		expect(articleFromPost(await postFrom('post-syntax-sample')).type).toBe('tech')
	})
})

describe('阅读时间', () => {
	it('中日韩文字按字计、其余按词计，标点不算词', () => {
		const result = readingTimeOf('你好，世界 hello world')
		expect(result.words).toBe(6)
		expect(result.minutes).toBeCloseTo(4 / 400 + 2 / 200)
		expect(result.text).toBe('1 min read')
	})
	it('空正文', () => {
		expect(readingTimeOf('')).toMatchObject({ words: 0, minutes: 0, text: '1 min read' })
	})
	it('分钟数四舍五入', () => {
		expect(readingTimeOf('字'.repeat(1000)).text).toBe('3 min read')
	})
})

describe('safeUrl', () => {
	it('只放行 http(s)', () => {
		expect(safeUrl('https://a.test/x')).toBe('https://a.test/x')
		expect(safeUrl('HTTP://a.test')).toBe('HTTP://a.test')
		expect(safeUrl('javascript:alert(1)')).toBeUndefined()
		expect(safeUrl('data:text/html,1')).toBeUndefined()
		expect(safeUrl('/relative')).toBeUndefined()
		expect(safeUrl(42)).toBeUndefined()
	})
})

describe('全量列表', () => {
	it('按 core 的实际上限 50 分页循环，页数以响应为准', async () => {
		const page = fixture('posts-page')
		const { client, requests } = clientWith((req) => {
			const n = Number(new URL(req.url).searchParams.get('page'))
			return jsonResponse({ ...page, meta: { pagination: { page: n, size: 50, total: 4, total_pages: 2 } } })
		})
		const articles = await loadAllArticles(client)
		expect(requests.map(r => new URL(r.url).searchParams.get('page'))).toEqual(['1', '2'])
		expect(requests.every(r => new URL(r.url).searchParams.get('size') === String(POST_PAGE_SIZE))).toBe(true)
		expect(articles).toHaveLength(page.data.length * 2)
		expect(articles[0]).not.toHaveProperty('text')
	})

	it('第一页之后每批 4 页并发取（不串行），结果按页序拼；页数封顶 100', async () => {
		const page = fixture('posts-page')
		let inFlight = 0
		let peak = 0
		const { client, requests } = clientWith(async (req) => {
			const n = Number(new URL(req.url).searchParams.get('page'))
			inFlight++
			peak = Math.max(peak, inFlight)
			await new Promise(resolve => setTimeout(resolve, 5))
			inFlight--
			return jsonResponse({ ...page, data: page.data.map((post: { id: string }) => ({ ...post, id: `${post.id}-${n}` })), meta: { pagination: { page: n, size: 50, total: 500, total_pages: 10 } } })
		})
		const articles = await loadAllArticles(client)
		expect(requests).toHaveLength(10)
		expect(peak).toBe(4)
		const pageOf = (id: string | undefined) => Number(id?.split('-').pop())
		const order = articles.map(article => pageOf(article.meta?.__id))
		expect(order).toEqual([...order].sort((a, b) => a - b))
		expect(new Set(order).size).toBe(10)
	})
})

describe('付费、版权与 AI 译文', () => {
	it('isPremium 留成 premium、copyright 为假才记下；两个都缺时不带这两个字段', async () => {
		const post = await postFrom('post-premium-locked')
		expect(articleFromPost(post).premium).toBe(true)
		expect(articleFromPost({ ...post, copyright: false }).copyright).toBe(false)
		const plain = articleFromPost(await postFrom('post-lexical-lists'))
		expect(plain.premium).toBeUndefined()
		expect(plain.copyright).toBeUndefined()
	})

	it('$meta.translation 按 id 取：是译文且原文语言认得出才算', () => {
		const meta = (article: unknown) => ({ translation: { '186000000000000102': { article } } })
		expect(translationOf(meta({ isTranslated: true, sourceLang: 'en' }), '186000000000000102')).toEqual({ sourceLang: 'en' })
		expect(translationOf(meta({ isTranslated: false, sourceLang: 'en' }), '186000000000000102')).toBeUndefined()
		expect(translationOf(meta({ isTranslated: true, sourceLang: 'zh' }), '186000000000000102')).toBeUndefined()
		expect(translationOf(meta({ isTranslated: true, sourceLang: '<b>' }), '186000000000000102')).toBeUndefined()
		expect(translationOf(meta({ isTranslated: true, sourceLang: 'en' }), '1')).toBeUndefined()
		expect(translationOf(undefined, '1')).toBeUndefined()
	})

	it('请求语言照 core 的规则折成两字母，只收开了的语言；站点语言、繁体中文（core 分不出）、白名单外的都按站点语言', () => {
		const enabled = ['en', 'ja']
		expect([contentLangOf('en', enabled), contentLangOf('EN-us', enabled), contentLangOf('jpn', enabled), contentLangOf('zh-TW', enabled), contentLangOf('zh', enabled), contentLangOf('ko', enabled), contentLangOf('xx', enabled), contentLangOf('en;drop', enabled), contentLangOf(['en'], enabled)])
			.toEqual(['en', 'en', 'ja', undefined, undefined, undefined, undefined, undefined, undefined])
		expect(languageName('en')).toBe('英语')
		expect(languageName('ja')).toBe('日语')
	})

	it('关键词：meta.keywords（数组或逗号分隔）优先，没有就用标签；输出时去重去空', () => {
		expect(articleKeywordsOf(['Vue', ' Nuxt '], ['标签'])).toEqual(['Vue', 'Nuxt'])
		expect(articleKeywordsOf('Vue，Nuxt, ', ['标签'])).toEqual(['Vue', 'Nuxt'])
		expect(articleKeywordsOf(undefined, ['标签'])).toEqual(['标签'])
		expect(articleKeywordsOf([], undefined)).toEqual([])
		expect(keywordsText(['a', 'a', ' ', 'b', 3])).toBe('a, b')
	})
})

describe('详情数据的 key 与上一篇、下一篇', () => {
	it('详情 key 编码与否都一样：存的一方用编码过的地址，目录挂件拿 vue-router 解码过的 route.path 来找', () => {
		expect(mxPostKey('/posts/%E6%8A%80%E6%9C%AF/%E4%BD%A0%E5%A5%BD')).toBe(mxPostKey('/posts/技术/你好'))
		expect(mxPostKey('/en/posts/tech/c%2B%2B')).toBe(mxPostKey('/en/posts/tech/c++'))
		expect(mxPostKey('/posts/tech/hello')).toBe('mx-post:/posts/tech/hello')
		// 坏编码原样用，不抛错
		expect(mxPostKey('/posts/%E0%A4%A')).toBe('mx-post:/posts/%E0%A4%A')
	})

	it('上一篇、下一篇：前缀版去掉语言前缀再找；中文与带 + 的 slug 编码与否都能对上；找不到是空的', () => {
		const sorted = [{ path: '/posts/tech/a' }, { path: '/posts/%E6%8A%80%E6%9C%AF/%E4%BD%A0%E5%A5%BD' }, { path: '/posts/tech/c%2B%2B' }, { path: '/posts/tech/d' }]
		expect(adjacentArticles(sorted, '/posts/技术/你好')).toEqual([sorted[0], sorted[2]])
		expect(adjacentArticles(sorted, '/en/posts/tech/c++')).toEqual([sorted[1], sorted[3]])
		expect(adjacentArticles(sorted, '/ja/posts/tech/a')).toEqual([undefined, sorted[1]])
		expect(adjacentArticles(sorted, '/posts/tech/d')).toEqual([sorted[2], undefined])
		expect(adjacentArticles(sorted, '/posts/tech/nope')).toEqual([])
	})
})
