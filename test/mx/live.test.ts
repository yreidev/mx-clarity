import type { ArticleProps } from '../../app/types/article'
import { describe, expect, it } from 'vitest'
import { loadReadingNow, publicReadingOnly, READING_BOARD_SIZE, reportRead, topReadFrom } from '../../app/utils/mx/explore'
import { coreWsUrlOf, createTtlSet, relayCoreFrame, roomFrame } from '../../app/utils/mx/live'
import { clientWith, fixture, jsonResponse } from './helpers'

/** core 广播帧的样本（每种事件一条，形状照真实的帧） */
const frames = fixture<{ event: string, payload: unknown }[]>('ws-frames')
const frameOf = (event: string) => JSON.stringify(frames.find(f => f.event === event))

describe('中继只放行白名单', () => {
	it('夹具里的 comment.create 确实带着评论者邮箱（前提）', () => {
		expect(frameOf('comment.create')).toContain('reader@example.test')
	})

	it('comment.create（不在房间里时）、gateway.connect 等一律丢弃', () => {
		for (const event of ['comment.create', 'gateway.connect'])
			expect(relayCoreFrame(frameOf(event)), event).toBeUndefined()
		for (const event of ['post.update', 'note.update', 'recently.create', 'unknown.event'])
			expect(relayCoreFrame(JSON.stringify({ v: 1, event, payload: { id: '1', mail: 'x@example.test' } })), event).toBeUndefined()
	})

	it('在线人数：只取人数', () => {
		expect(relayCoreFrame(frameOf('visitor.online'))).toEqual({ type: 'online', count: expect.any(Number) })
		expect(relayCoreFrame(JSON.stringify({ v: 1, event: 'visitor.offline', payload: { online: 3, sessionId: 'someone-else', timestamp: 'x' } })))
			.toEqual({ type: 'online', count: 3 })
	})

	it('阅读次数更新：重新组装，不整包转发', () => {
		expect(relayCoreFrame(frameOf('article.read_count_update'))).toEqual({ type: 'read', kind: 'post', id: '183590000000000001', count: expect.any(Number) })
		const extra = JSON.stringify({ v: 1, event: 'article.read_count_update', payload: { count: 5, id: '9', type: 'note', title: '不该出去', mail: 'x@example.test' } })
		expect(relayCoreFrame(extra)).toEqual({ type: 'read', kind: 'note', id: '9', count: 5 })
	})

	it('字段不对、不是 JSON、太长的帧丢弃', () => {
		const bad = [
			'not json',
			JSON.stringify({ v: 1, event: 'visitor.online', payload: { online: -1 } }),
			JSON.stringify({ v: 1, event: 'visitor.online', payload: { online: '3' } }),
			JSON.stringify({ v: 1, event: 'article.read_count_update', payload: { count: 1, id: '../x', type: 'post' } }),
			JSON.stringify({ v: 1, event: 'article.read_count_update', payload: { count: 1, id: '1', type: 'page' } }),
			JSON.stringify({ v: 1, event: 'visitor.online', payload: { online: 1, pad: 'x'.repeat(70_000) } }),
		]
		for (const raw of bad)
			expect(relayCoreFrame(raw), raw.slice(0, 60)).toBeUndefined()
	})
})

describe('发给 core 的帧', () => {
	it('发给 core 的房间名照 core 的约定', () => {
		expect(JSON.parse(roomFrame('room.join', '42'))).toEqual({ v: 1, event: 'room.join', payload: { room: 'article-42' } })
	})
})

describe('core 的 WebSocket 地址', () => {
	it('不在 /api/v3 下，http 换成 ws', () => {
		expect(coreWsUrlOf('http://app:2333/api/v3', 'abcdefgh')).toBe('ws://app:2333/ws/web?socket_session_id=abcdefgh&lang=zh')
		expect(coreWsUrlOf('https://mx.example.test/api/v3/', 'abcdefgh')).toBe('wss://mx.example.test/ws/web?socket_session_id=abcdefgh&lang=zh')
		expect(coreWsUrlOf('http://127.0.0.1:2333', 'abcdefgh')).toBe('ws://127.0.0.1:2333/ws/web?socket_session_id=abcdefgh&lang=zh')
	})
})

describe('去重', () => {
	it('同一个键在有效期内只算一次，过期后重新算；满了先丢最早的', () => {
		let t = 0
		const seen = createTtlSet(1000, 2, () => t)
		expect(seen.add('a')).toBe(true)
		expect(seen.add('a')).toBe(false)
		t = 1000
		expect(seen.add('a')).toBe(true)
		expect(seen.add('b')).toBe(true)
		expect(seen.add('c')).toBe(true)
		expect(seen.size).toBe(2)
		// 'a' 被挤掉了，再来算新的
		expect(seen.add('a')).toBe(true)
	})

	it('撤销一次记下（上报 core 失败时用）：同一个键马上又能算', () => {
		const seen = createTtlSet(60_000, 10, () => 0)
		expect(seen.add('ip:post:1')).toBe(true)
		expect(seen.add('ip:post:1')).toBe(false)
		seen.delete('ip:post:1')
		expect(seen.add('ip:post:1')).toBe(true)
	})
})

describe('侧栏「阅读」', () => {
	it('正在阅读：房间人数配上标题与本站地址，人多的在前，别的房间跳过', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('activity-rooms')))
		const now = await loadReadingNow(client)
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/activity/rooms')
		expect(now).toEqual([
			{ title: '示例文章', path: '/posts/tech/hello-world', count: 2 },
			expect.objectContaining({ path: '/notes/2', count: 1 }),
			expect.objectContaining({ path: '/about', count: 1 }),
		])
	})

	it('正在阅读只留公开清单里的地址：草稿、定时公开、没发布的内容就算有人在读也不列，编码不同照样对得上', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('activity-rooms')))
		const now = await loadReadingNow(client)
		expect(publicReadingOnly(now, ['/posts/tech/hello-world', '/about']).map(e => e.path)).toEqual(['/posts/tech/hello-world', '/about'])
		expect(publicReadingOnly(now, [])).toEqual([])
		const encoded = [{ title: '中文', path: '/%E4%B8%AD%E6%96%87', count: 1 }]
		expect(publicReadingOnly(encoded, ['/中文'])).toEqual(encoded)
		expect(publicReadingOnly([{ title: '坏', path: '/%E0%A4%A', count: 1 }], ['/%E0%A4%A'])).toHaveLength(1)
	})

	it('阅读最多：没人读过的不列，最多 5 条', () => {
		const article = (title: string, readCount: number) => ({ title, path: `/${title}`, readCount }) as ArticleProps
		const list = [article('a', 3), article('b', 0), article('c', 9), ...Array.from({ length: 6 }, (_, i) => article(`x${i}`, 1))]
		const top = topReadFrom(list)
		expect(top).toHaveLength(READING_BOARD_SIZE)
		expect(top.slice(0, 2)).toEqual([{ title: 'c', path: '/c', count: 9 }, { title: 'a', path: '/a', count: 3 }])
		expect(top.find(t => t.title === 'b')).toBeUndefined()
	})

	it('阅读量上报发给 /ack', async () => {
		const { client, requests } = clientWith(() => new Response(null, { status: 200 }))
		await reportRead(client, 'note', '42')
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/ack')
		expect(await requests[0]!.json()).toEqual({ type: 'read', payload: { type: 'note', id: '42' } })
	})
})
