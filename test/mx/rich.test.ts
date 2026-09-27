/**
 * 富内容与互动：图集、嵌入、文件、画板、图片元数据、链接卡片、投票、股票、地图、站内预览的判定。
 */
import type { MDCElement, MDCRoot } from '@nuxtjs/mdc'
import { describe, expect, it } from 'vitest'
import { renderMarkdownBody, sanitizeBody } from '../../app/utils/mx/body'
import { candleChart, ema, mapChart, sparklinePath, trackDistance } from '../../app/utils/mx/charts'
import { applyLinkPreviews, linkPreviewOf, previewLookupOf } from '../../app/utils/mx/enrichment'
import { feedHtmlOf } from '../../app/utils/mx/feed-html'
import { renderLexicalBody } from '../../app/utils/mx/lexical'
import { loadPollStates, pollStateFrom, submitVote } from '../../app/utils/mx/polls'
import { applyImageMeta, embedTargetOf, excalidrawSummaryOf, fileCardPropsOf, fileSizeText, galleryPropsOf, imageMetaOf, imageMetaTableOf, mapPropsOf, mapTrackOf, pollPropsOf, staticPolls, stockPropsOf, trustedTrackUrl } from '../../app/utils/mx/rich-blocks'
import { stockBarsFrom, stockQuoteFrom } from '../../app/utils/mx/stocks'
import { peekTargetOf } from '../../shared/utils/peek'
import { clientWith, jsonResponse } from './helpers'

const lexical = (...children: Record<string, unknown>[]) => renderLexicalBody({ root: { type: 'root', children } })
const first = (body: MDCRoot) => body.children[0] as MDCElement

describe('图集、嵌入、文件、画板', () => {
	it('图集：布局与 fit 只认几种，最大高度限范围；每张图照样过元数据校验', async () => {
		expect(galleryPropsOf({ layout: 'masonry', fit: 'contain', maxItemHeight: 480 })).toEqual({ layout: 'masonry', fit: 'contain', maxHeight: 480 })
		expect(galleryPropsOf({ layout: 'evil', fit: 'x', maxItemHeight: 99999 })).toEqual({ layout: 'grid', fit: 'cover' })
		const { body } = await lexical({ type: 'gallery', layout: 'carousel', images: [{ src: 'https://a.example/1.png', alt: '一', accent: '#abcdef', width: 800, height: 600 }, { src: 'javascript:alert(1)' }] })
		expect(first(body).tag).toBe('mx-gallery')
		expect(first(body).children).toHaveLength(1)
		expect((first(body).children[0] as MDCElement).props).toMatchObject({ src: 'https://a.example/1.png', accent: '#abcdef', width: 800, height: 600 })
	})

	it('嵌入：YouTube、B 站按网址认出视频；别的画链接卡片，标题是主机加路径；危险地址不要', () => {
		expect(embedTargetOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'video', type: 'youtube', id: 'dQw4w9WgXcQ' })
		expect(embedTargetOf('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({ type: 'youtube' })
		expect(embedTargetOf('https://www.bilibili.com/video/BV1xx411c7mD/')).toEqual({ kind: 'video', type: 'bilibili', id: 'BV1xx411c7mD' })
		expect(embedTargetOf('https://github.com/a/b/blob/main/README.md')).toEqual({ kind: 'link', link: 'https://github.com/a/b/blob/main/README.md', title: 'github.com/a/b/blob/main/README.md' })
		expect(embedTargetOf('https://evil.example/watch?v=dQw4w9WgXcQ')).toMatchObject({ kind: 'link' })
		expect(embedTargetOf('javascript:alert(1)')).toBeUndefined()
	})

	it('文件：地址只收 http(s) 与站内路径，大小换成人读的写法，行内显示成链接', async () => {
		expect(fileCardPropsOf({ src: 'https://a.example/f.pdf', name: '报告.pdf', size: 1536, ext: 'PDF' })).toEqual({ src: 'https://a.example/f.pdf', name: '报告.pdf', ext: 'pdf', size: '1.5 KB', inline: false })
		expect(fileCardPropsOf({ src: 'javascript:alert(1)', name: 'x' })).toBeUndefined()
		expect(fileCardPropsOf({ src: '//evil.example/x', name: 'x' })).toBeUndefined()
		expect(fileSizeText(10)).toBe('10 B')
		expect(fileSizeText(5 * 1024 * 1024)).toBe('5.0 MB')
		expect(fileSizeText(-1)).toBe('')
		const { body } = await lexical({ type: 'file', src: '/api/v3/objects/file/a.zip', name: 'a.zip', display: 'inline' })
		expect(first(body).tag).toBe('p')
	})

	it('画板：数元素、列出文字；远端与坏掉的快照当作没有', () => {
		const snapshot = JSON.stringify({ elements: [{ type: 'text', text: '标题\n第二行' }, { type: 'rectangle' }, { type: 'text', text: '删掉的', isDeleted: true }] })
		expect(excalidrawSummaryOf(snapshot)).toEqual({ count: 2, texts: ['标题 第二行'] })
		expect(excalidrawSummaryOf('https://a.example/scene.json')).toBeUndefined()
		expect(excalidrawSummaryOf('{broken')).toBeUndefined()
		expect(excalidrawSummaryOf(`{"elements":[${'1,'.repeat(600_000)}1]}`)).toBeUndefined()
	})
})

describe('图片的元数据', () => {
	it('宽高、主色、thumbhash 各自校验，不合格的丢掉', () => {
		expect(imageMetaOf({ width: 800, height: '600', accent: '#AbC', thumbhash: 'HBkSHYSIeHiPiHh8eJd4eTN0EEQG' })).toEqual({ width: 800, height: 600, accent: '#AbC', thumbhash: 'HBkSHYSIeHiPiHh8eJd4eTN0EEQG' })
		expect(imageMetaOf({ width: 0, height: 99999, accent: 'red;background:url(x)', thumbhash: '<script>' })).toEqual({})
	})

	it('路径 B：按文档的 images 表补上，网址两边规整后对得上（mdc 会编码中文）', async () => {
		const { body } = await renderMarkdownBody('![图](https://a.example/图片.png)')
		const table = imageMetaTableOf([{ src: 'https://a.example/图片.png', width: 400, height: 300, accent: '#112233' }, { width: 1 }])
		applyImageMeta(body, table)
		const img = JSON.stringify(body)
		expect(img).toContain('"accent":"#112233"')
		expect(img).toContain('"width":400')
	})
})

describe('链接卡片（enrichments）', () => {
	const enrichments = {
		'https://github.com/a/b': { title: 'a/b', description: '仓库说明', url: 'javascript:alert(1)', category: 'github', attributes: [{ key: 'stars', value: 1234, format: 'number' }, { key: 'language', value: 'TypeScript' }, { key: 'site', value: 'GitHub' }, { key: 'evil', value: 'x' }], color: '#123456', thumbnailImage: { url: 'https://tracker.example/pixel.png' } },
		'https://zh.wikipedia.org/wiki/中文': { title: '中文', category: 'web', color: 'red;background:url(https://tracker.example)' },
		'https://blog.example/notes/2022/1/1/secret': { title: '加密日记', description: '正文前 300 字', category: 'self', subtype: 'note' },
	}

	it('只取文字：图片、条目里的 url 不要，属性换成中文标签，主色只收 #rrggbb', () => {
		expect(linkPreviewOf(enrichments['https://github.com/a/b'])).toEqual({ title: 'a/b', description: '仓库说明', kind: 'github', site: 'GitHub', facts: ['星标：1,234', '语言：TypeScript'], accent: '#123456' })
		expect(linkPreviewOf(enrichments['https://zh.wikipedia.org/wiki/中文'])?.accent).toBeUndefined()
		// 站内卡片不带描述（core 的 note-date 分支疑似会带出加密日记的正文）
		expect(linkPreviewOf(enrichments['https://blog.example/notes/2022/1/1/secret'])).toEqual({ title: '加密日记', kind: 'self', facts: [], description: '站内日记' })
	})

	it('单独成段、文字就是网址的链接换成卡片，链接用作者写的；带自定义文字的不换；编码与否都查得到', async () => {
		const { body } = await renderMarkdownBody('https://github.com/a/b\n\n[看这个](https://github.com/a/b)\n\nhttps://zh.wikipedia.org/wiki/中文')
		applyLinkPreviews(body, previewLookupOf(enrichments))
		const [card, custom, wiki] = body.children as MDCElement[]
		expect(card).toMatchObject({ tag: 'link-card', props: { link: 'https://github.com/a/b', title: 'a/b', kind: 'github' } })
		expect(custom!.tag).toBe('p')
		expect(wiki).toMatchObject({ tag: 'link-card', props: { title: '中文' } })
		const out = JSON.stringify(body)
		expect(out).not.toContain('tracker.example')
		expect(out).not.toContain('javascript:')
	})

	it('lexical 的 link-card 节点换上条目的文字，节点的链接不变', async () => {
		const { body } = await lexical({ type: 'link-card', url: 'https://github.com/a/b', title: '旧标题' })
		applyLinkPreviews(body, previewLookupOf(enrichments))
		expect(first(body).props).toMatchObject({ link: 'https://github.com/a/b', title: 'a/b', description: '仓库说明' })
	})

	it('路径 B 手写的 link-card 也过协议白名单', () => {
		const body: MDCRoot = { type: 'root', children: [{ type: 'element', tag: 'link-card', props: { link: 'javascript:alert(1)', title: 'x' }, children: [] }, { type: 'element', tag: 'link-card', props: { link: 'https://a.example', icon: 'javascript:alert(2)', title: 'y' }, children: [] }] }
		sanitizeBody(body)
		expect(body.children).toHaveLength(1)
		expect((body.children[0] as MDCElement).props).toEqual({ link: 'https://a.example', title: 'y' })
	})
})

describe('投票', () => {
	it('节点：id 按 core 的格式校验，不合格的退回静态列表', async () => {
		const good = { type: 'poll', pollId: 'p_abc1', question: '选哪个', mode: 'multiple', options: [{ id: 'o_a', label: '甲' }, { id: 'o_b', label: '乙' }], showResults: 'after-vote', closeAt: '2030-01-01T00:00:00Z' }
		expect(pollPropsOf(good)).toEqual({ pollId: 'p_abc1', question: '选哪个', mode: 'multiple', options: JSON.stringify([{ id: 'o_a', label: '甲' }, { id: 'o_b', label: '乙' }]), closeAt: '2030-01-01T00:00:00Z', showResults: 'after-vote' })
		expect(pollPropsOf({ ...good, pollId: 'p1' })).toBeUndefined()
		expect(pollPropsOf({ ...good, options: [{ id: 'o_a' }, { id: 'o_a' }] })).toBeUndefined()
		const { body } = await lexical({ ...good, pollId: 'p_demo_single' })
		expect(first(body).tag).toBe('div')
		expect(JSON.stringify(body)).toContain('格式不对')
	})

	it('草稿、加密日记里换成静态列表', async () => {
		const { body } = await lexical({ type: 'poll', pollId: 'p_x1', question: '问', options: [{ id: 'o_1', label: '一' }] })
		staticPolls(body)
		expect(first(body)).toMatchObject({ tag: 'div', props: { className: ['mx-poll'] } })
		expect(JSON.stringify(body)).toContain('不能参与')
	})

	it('状态：snake_case 自己映射，选项 id 不被改坏，错误换成中文', () => {
		expect(pollStateFrom({ tallies: { o_abc: 3, o_Bad_: 1, x: 2 }, total_votes: 4, user_vote: ['o_abc', 'bad'], status: 'ready', closed: false, can_vote: false }))
			.toEqual({ tallies: { o_abc: 3 }, totalVotes: 4, userVote: ['o_abc'], closed: false, canVote: false })
		expect(pollStateFrom({ status: 'error', error_message: 'Already voted' }).error).toBe('你已经投过了')
		expect(pollStateFrom({ status: 'error', error_message: 'Something new <b>' }).error).toBe('暂时无法投票')
	})

	it('取状态带 ts、不转 camelCase；投票的请求体是 camelCase 的 optionIds', async () => {
		const { client, requests } = clientWith(req => new URL(req.url).pathname.endsWith('/vote')
			? jsonResponse({ data: { tallies: { o_abc: 1 }, total_votes: 1, user_vote: ['o_abc'], status: 'ready', closed: false, can_vote: false } })
			: jsonResponse({ data: { p_one: { tallies: { o_abc: 2 }, total_votes: 2, status: 'ready', closed: false, can_vote: true } } }))
		const states = await loadPollStates(client, ['p_one', 'p_two'])
		expect(states.p_one).toMatchObject({ tallies: { o_abc: 2 }, canVote: true })
		expect(states.p_two!.error).toBe('找不到这个投票')
		const query = new URL(requests[0]!.url).searchParams
		expect(query.get('ids')).toBe('p_one,p_two')
		expect(Number(query.get('ts'))).toBeGreaterThan(0)
		const voted = await submitVote(client, 'p_one', ['o_abc'])
		expect(voted.userVote).toEqual(['o_abc'])
		expect(await requests[1]!.json()).toEqual({ optionIds: ['o_abc'] })
	})
})

describe('股票', () => {
	it('节点：代码只收安全字符；K 线的粒度、区间、跨度不合格就当快照', () => {
		expect(stockPropsOf({ symbol: ' aapl ' })).toEqual({ symbol: 'AAPL', variant: 'snapshot' })
		expect(stockPropsOf({ symbol: 'A,B' })).toBeUndefined()
		expect(stockPropsOf({ symbol: '9988.HK', variant: 'kline', range: { interval: '1d', from: '2024-01-01T00:00:00Z', to: '2024-06-30T00:00:00Z' } }))
			.toEqual({ symbol: '9988.HK', variant: 'kline', interval: '1d', from: '2024-01-01T00:00:00.000Z', to: '2024-06-30T00:00:00.000Z', ema: [5, 20] })
		expect(stockPropsOf({ symbol: 'AAPL', variant: 'kline', range: { interval: '5m', from: '2024-01-01T00:00:00Z', to: '2024-06-30T00:00:00Z' } })!.variant).toBe('snapshot')
		expect(stockPropsOf({ symbol: 'AAPL', variant: 'kline', ema: false, range: { interval: '1h', from: '2024-01-01T00:00:00Z', to: '2024-01-05T00:00:00Z' } })!.ema).toEqual([])
	})

	it('行情：数值过 isFinite，文字限长，走势画成路径；没有价格就当取不到', () => {
		const quote = stockQuoteFrom({ symbol: 'AAPL', longName: 'Apple Inc', currency: 'USD', price: 200, previousClose: 190, sparkline: [{ close: 1 }, { close: 3 }, { close: 2 }], asOf: 1719830400, marketState: 'closed', volume: 'x' })
		expect(quote).toMatchObject({ name: 'Apple Inc', price: 200, previousClose: 190, volume: 0, open: false, asOf: '2024-07-01T10:40:00.000Z' })
		expect(quote!.spark).toMatch(/^M0 \d/)
		expect(stockQuoteFrom({ price: 0 })).toBeUndefined()
		expect(stockBarsFrom({ bars: [{ open: 1, high: 2, low: 0.5, close: 1.5 }] })).toBeUndefined()
	})

	it('图：走势线、EMA、K 线', () => {
		expect(sparklinePath([1, 2], 10, 10)).toBe('M0 8 L10 2')
		expect(sparklinePath([1])).toBe('')
		expect(ema([1, 2, 3, 4], 2)).toEqual([undefined, 1.5, 2.5, 3.5])
		const chart = candleChart([{ open: 1, high: 3, low: 0, close: 2 }, { open: 2, high: 2, low: 1, close: 1 }], [2])
		expect(chart).toMatchObject({ min: 0, max: 3 })
		expect(chart!.up).toMatch(/^M/)
		expect(chart!.down).toMatch(/^M/)
		expect(chart!.emas).toHaveLength(1)
	})
})

describe('地图', () => {
	it('地点逐项校验：经纬度范围、文字限长、网站只收 http(s)、电话只留数字', () => {
		const props = mapPropsOf({ title: '东京', pois: [{ lat: 35.68, lon: 139.76, title: '东京站', merchant: { website: 'javascript:alert(1)', phone: '+81 3-1234<script>' } }, { lat: 200, lon: 0 }] })
		expect(JSON.parse(String(props!.pois))).toEqual([{ lat: 35.68, lon: 139.76, title: '东京站', phone: '+81 3-1234' }])
		expect(mapPropsOf({ pois: [] })).toBeUndefined()
		expect(mapPropsOf({ track: { url: 'http://a.example/t.json' } })).toBeUndefined()
	})

	it('轨迹：点是 [纬度, 经度]，坏点丢掉、抽稀；只从站点或 core 的主机取', () => {
		const track = mapTrackOf({ points: [[35, 139, null], [35.1, 139.1, 10], ['x', 1], [91, 0]], distanceMeters: 1200 })
		expect(track).toEqual({ segments: [[{ lat: 35, lon: 139 }, { lat: 35.1, lon: 139.1 }]], stops: [], distance: 1200, start: undefined, end: undefined })
		expect(mapTrackOf({ points: Array.from({ length: 5000 }, (_, i) => [30 + i / 1e4, 120]) })!.segments[0]!.length).toBeLessThanOrEqual(1000)
		const site = { webUrl: 'https://blog.example', serverUrl: 'https://blog.example/api/v3' }
		expect(trustedTrackUrl('https://blog.example/api/v3/objects/file/a.json', site)).toBe('https://blog.example/api/v3/objects/file/a.json')
		for (const bad of ['https://evil.example/a.json', 'http://blog.example/a.json', 'https://u@blog.example/a.json', 'https://blog.example.evil.example/a.json'])
			expect(trustedTrackUrl(bad, site), bad).toBeUndefined()
	})

	it('投影：轨迹与地点在同一个框里，距离按大圆算', () => {
		const chart = mapChart([[{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }]], [{ lat: 0.5, lon: 0.5 }], 100, 100, 10)
		expect(chart!.tracks[0]).toMatch(/^M\d/)
		expect(chart!.markers[0]!.x).toBeGreaterThan(10)
		expect(chart!.markers[0]!.x).toBeLessThan(90)
		expect(Math.round(trackDistance([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }]) / 1000)).toBe(111)
	})
})

describe('订阅源里的新块', () => {
	it('投票、股票、地图、附件都有文字兜底', async () => {
		const body: MDCRoot = { type: 'root', children: [
			{ type: 'element', tag: 'mx-poll', props: { question: '问', options: JSON.stringify([{ id: 'o_1', label: '一' }, { id: 'o_2', label: '<二>' }]) }, children: [] },
			{ type: 'element', tag: 'stock-block', props: { symbol: 'AAPL', price: 200, currency: 'USD' }, children: [] },
			{ type: 'element', tag: 'map-block', props: { title: '东京', pois: JSON.stringify([{ title: '东京站' }]) }, children: [] },
			{ type: 'element', tag: 'file-card', props: { src: '/f.zip', name: 'f.zip', size: '1 KB' }, children: [] },
		] }
		const html = feedHtmlOf(body, { base: 'https://blog.example/', link: 'https://blog.example/posts/a/b' })
		expect(html).toContain('投票：问')
		expect(html).toContain('&lt;二&gt;')
		expect(html).toContain('〔股票 AAPL：200 USD〕')
		expect(html).toContain('〔地图：东京〕')
		expect(html).toContain('href="https://blog.example/f.zip"')
	})
})

describe('站内链接预览的判定', () => {
	const here = 'https://blog.example/posts/tech/current'
	const origins = ['https://blog.example']

	it('只认文章与日记，同源的绝对地址也认', () => {
		expect(peekTargetOf('/posts/tech/hello', here, origins)).toEqual({ kind: 'post', category: 'tech', slug: 'hello', path: '/posts/tech/hello' })
		expect(peekTargetOf('https://blog.example/notes/3?x=1#c', here, origins)).toEqual({ kind: 'note', nid: 3, path: '/notes/3' })
		expect(peekTargetOf('/posts/%E6%8A%80%E6%9C%AF/a', here, origins)).toMatchObject({ category: '技术' })
	})

	it('标签页、专栏、别的站、锚点、当前这篇、坏编码一概不接', () => {
		for (const href of ['/posts/tag/vue', '/notes/series/x', '/notes/0', '/posts/a/b/c', '/about', 'https://evil.example/posts/a/b', '//evil.example/posts/a/b', 'javascript:alert(1)', '#fn-1', '/posts/tech/current#x', '/posts/%E0%A4%A/b'])
			expect(peekTargetOf(href, here, origins), href).toBeUndefined()
	})
})
