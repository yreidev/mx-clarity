import { describe, expect, it } from 'vitest'
import { classifyMxError } from '../../app/utils/mx/errors'
import { clientWith, fixture, jsonResponse } from './helpers'

describe('每个请求都带 ?lang=zh', () => {
	it('分页参数由 api-client 拼进 URL，lang 与之合并而不是手拼', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('posts-page')))
		await client.post.getList(1, 5)
		const url = new URL(requests[0]!.url)
		expect(url.pathname).toBe('/api/v3/posts')
		expect(url.searchParams.get('page')).toBe('1')
		expect(url.searchParams.get('size')).toBe('5')
		expect(url.searchParams.getAll('lang')).toEqual(['zh'])
	})

	it('调用方显式传别的 lang 也被压成 zh', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('aggregate')))
		await client.aggregate.getAggregateData('mx-clarity', { lang: 'en' })
		const url = new URL(requests[0]!.url)
		expect(url.searchParams.getAll('lang')).toEqual(['zh'])
		expect(url.searchParams.get('theme')).toBe('mx-clarity')
	})

	it('写请求的 params 原样交给适配器（GET 的才会被拼进 URL），其中的 lang 也被压成 zh', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: {} }))
		await client.proxy.comments.guest('1').post({ params: { lang: 'en', ref: 'x' }, data: {} })
		const url = new URL(requests[0]!.url)
		expect(url.searchParams.getAll('lang')).toEqual(['zh'])
		expect(url.searchParams.get('ref')).toBe('x')
	})

	it('写请求同样带 lang', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { ok: true } }))
		await client.proxy.comments.guest('1').post({ data: { text: 'hi' } })
		expect(requests[0]!.method).toBe('POST')
		expect(new URL(requests[0]!.url).searchParams.get('lang')).toBe('zh')
		expect(await requests[0]!.json()).toEqual({ text: 'hi' })
	})
})

describe('响应解析', () => {
	it('snake_case 转 camelCase，分页提到顶层（坑 1：不覆盖 getDataFromResponse）', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('posts-page')))
		const res = await client.post.getList(1, 2)
		expect(res.data).toHaveLength(2)
		expect(res.pagination).toMatchObject({ page: 1, size: 2, total: 6, totalPages: 3 })
		expect(res.data[0]).toHaveProperty('createdAt')
		expect(res.data[0]).not.toHaveProperty('created_at')
	})

	it('以 URL 为键的对象保持原样，值内部照常转换（坑 2）', async () => {
		const { client } = clientWith(() => jsonResponse({
			data: { enrichments: { 'https://github.com/mx-space/core': { fetch_state: 'ok' } } },
		}))
		const res = await client.proxy.enrichments.get<any>()
		expect(Object.keys(res.enrichments)).toEqual(['https://github.com/mx-space/core'])
		expect(res.enrichments['https://github.com/mx-space/core']).toEqual({ fetchState: 'ok' })
	})
})

describe('服务端渲染时转发访客 IP', () => {
	it('插件传入的 X-Forwarded-For 出现在每个请求上', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('aggregate-site')), {
			headers: { 'x-forwarded-for': '203.0.113.9' },
		})
		await client.aggregate.getSiteMetadata()
		expect(requests[0]!.headers.get('x-forwarded-for')).toBe('203.0.113.9')
	})
})

describe('重试与错误分类', () => {
	const rateLimited = (retryAfter: string) => jsonResponse(
		{ error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
		{ status: 429, headers: { 'retry-after': retryAfter } },
	)

	it('429 且 retry-after 在等待上限内：等待后重试一次', async () => {
		const { client, requests, sleeps } = clientWith(
			(_, i) => i === 0 ? rateLimited('1') : jsonResponse(fixture('aggregate-site')),
			{ maxRetryWaitMs: 2000 },
		)
		const res = await client.aggregate.getSiteMetadata()
		expect(res.seo.title).toBe('My Little World')
		expect(requests).toHaveLength(2)
		expect(sleeps).toEqual([1000])
	})

	it('429 且 retry-after 超过上限：不等，直接归为 rate-limited', async () => {
		const { client, requests, sleeps } = clientWith(() => rateLimited('10'), { maxRetryWaitMs: 2000 })
		const error = await client.aggregate.getSiteMetadata().catch(e => e)
		expect(requests).toHaveLength(1)
		expect(sleeps).toEqual([])
		expect(classifyMxError(error)).toMatchObject({ kind: 'rate-limited', status: 429, code: 'RATE_LIMITED' })
	})

	it('写请求被限流不重试', async () => {
		const { client, requests } = clientWith(() => rateLimited('1'), { maxRetryWaitMs: 2000 })
		await client.proxy.comments.guest('1').post({ data: {} }).catch(() => {})
		expect(requests).toHaveLength(1)
	})

	it('core 不可达：只请求一次（关掉了 ofetch 的默认重试），归为 unavailable', async () => {
		const { client, requests } = clientWith(() => {
			throw new TypeError('fetch failed')
		})
		const error = await client.aggregate.getSiteMetadata().catch(e => e)
		expect(requests).toHaveLength(1)
		expect(classifyMxError(error)).toMatchObject({ kind: 'unavailable', status: 0, code: 'NETWORK_ERROR' })
	})

	it('5xx：只请求一次，归为 unavailable', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 502 }))
		const error = await client.aggregate.getSiteMetadata().catch(e => e)
		expect(requests).toHaveLength(1)
		expect(classifyMxError(error)).toMatchObject({ kind: 'unavailable', status: 502 })
	})

	it('超时：归为 unavailable', async () => {
		const { client } = clientWith(request => new Promise<Response>((_, reject) => {
			request.signal.addEventListener('abort', () => reject(request.signal.reason))
		}), { timeout: 20 })
		const error = await client.aggregate.getSiteMetadata().catch(e => e)
		expect(classifyMxError(error).kind).toBe('unavailable')
	})

	it('core 的 404 响应按 code 归为 not-found', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('error-404-category'), { status: 404 }))
		const error = await client.category.getCategoryByIdOrSlug('does-not-exist').catch(e => e)
		expect(classifyMxError(error)).toMatchObject({ kind: 'not-found', status: 404, code: 'CATEGORY_NOT_FOUND' })
	})

	it('core 的 422 响应归为 invalid-request', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('error-422-size'), { status: 422 }))
		const error = await client.post.getList(1, 101).catch(e => e)
		expect(classifyMxError(error)).toMatchObject({ kind: 'invalid-request', status: 422, code: 'VALIDATION_FAILED' })
	})
})
