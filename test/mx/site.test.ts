import { describe, expect, it } from 'vitest'
import { staticSiteConfig } from '../../app/utils/mx/adapter'
import { classifyMxError, pageErrorOf } from '../../app/utils/mx/errors'
import { loadCoreVersion, loadSiteConfig } from '../../app/utils/mx/site'
import blogConfig from '../../blog.config'
import { clientWith, fixture, jsonResponse } from './helpers'

const notFound = () => jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 })

describe('站点配置的降级链', () => {
	it('聚合接口可用：source=aggregate；主题配置不再从这里取', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('aggregate')))
		const site = await loadSiteConfig(client)
		expect(site).toMatchObject({
			source: 'aggregate',
			title: 'My Little World',
			author: { name: 'Dev Owner' },
			webUrl: 'http://localhost:2323',
			comments: { enabled: true, allowGuest: true },
		})
		expect(new URL(requests[0]!.url).searchParams.get('theme')).toBeNull()
	})

	it('不映射站长邮箱：公开的 /aggregate 会返回它', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('aggregate')))
		const site = await loadSiteConfig(client)
		expect(JSON.stringify(site)).not.toContain('dev@localhost.test')
	})

	it('聚合接口 404（没有日记时必然如此）：退到 /aggregate/site，头像从 /owner 补', async () => {
		const { client, requests } = clientWith((req) => {
			const path = new URL(req.url).pathname
			if (path.endsWith('/aggregate/site'))
				return jsonResponse(fixture('aggregate-site'))
			if (path.endsWith('/owner'))
				return jsonResponse(fixture('owner'))
			return notFound()
		})
		const site = await loadSiteConfig(client)
		expect(site.source).toBe('site')
		expect(site.title).toBe('My Little World')
		expect(site.author.avatar).toBe(fixture<{ data: { avatar: string } }>('owner').data.avatar)
		// /owner 也带着站长邮箱，不能映射出去
		expect(JSON.stringify(site)).not.toContain('dev@localhost.test')
		// 没有日记的站点一直停在这一级：评论设置按 core 的默认，允许匿名
		expect(site.comments).toEqual({ enabled: true, allowGuest: true })
		expect(requests.map(r => new URL(r.url).pathname).sort()).toEqual(['/api/v3/aggregate', '/api/v3/aggregate/site', '/api/v3/owner'])
	})

	it('第二级里 /owner 失败不影响：头像退回 blog.config.ts', async () => {
		const { client } = clientWith(req => new URL(req.url).pathname.endsWith('/aggregate/site')
			? jsonResponse(fixture('aggregate-site'))
			: notFound())
		const site = await loadSiteConfig(client)
		expect(site.source).toBe('site')
		expect(site.author.avatar).toBe(blogConfig.author.avatar)
	})

	it('两级都失败：抛出第一级的错误，交给调用方退到静态值', async () => {
		const { client } = clientWith(() => {
			throw new TypeError('fetch failed')
		})
		const error = await loadSiteConfig(client).catch(e => e)
		expect(classifyMxError(error).kind).toBe('unavailable')
	})

	it('静态兜底取自 blog.config.ts，且关闭评论', () => {
		expect(staticSiteConfig()).toMatchObject({
			source: 'static',
			title: blogConfig.title,
			icon: blogConfig.favicon,
			comments: { enabled: false, allowGuest: false },
		})
	})
})

describe('页面错误', () => {
	it('按类别给状态码', () => {
		const status = (kind: Parameters<typeof pageErrorOf>[0]['kind']) => pageErrorOf({ kind, status: 0, code: '', message: '' }).statusCode
		expect(status('not-found')).toBe(404)
		expect(status('unavailable')).toBe(503)
		expect(status('rate-limited')).toBe(503)
		expect(status('invalid-request')).toBe(500)
		expect(status('unauthorized')).toBe(500)
	})

	it('message 不带 core 返回的文案和路径（错误页用 v-html 渲染标题）', () => {
		const payload = '<img src=x onerror=alert(1)>'
		for (const kind of ['not-found', 'rate-limited', 'unavailable', 'unauthorized', 'invalid-request'] as const) {
			const error = pageErrorOf({ kind, status: 500, code: payload, message: payload, path: `/posts/${payload}` })
			expect(error.message).not.toContain('<')
		}
	})
})

describe('core 的版本', () => {
	it('取公开的 /info 里的 version（实测返回形状）；认不出时是空串', async () => {
		const paths: string[] = []
		const info = { data: { name: '@mx-space/core', author: 'Innei <https://innei.in>', version: '14.13.0', homepage: 'https://github.com/mx-space/core', issues: 'https://github.com/mx-space/core/issues' } }
		const fetchJson = async (path: string) => {
			paths.push(path)
			return info
		}
		expect(await loadCoreVersion(fetchJson)).toBe('14.13.0')
		expect(paths).toEqual(['/info'])
		expect(await loadCoreVersion(async () => ({ data: { version: '<b>1</b>' } }))).toBe('')
		expect(await loadCoreVersion(async () => ({ data: null }))).toBe('')
		expect(await loadCoreVersion(async () => 'pong')).toBe('')
	})
})
