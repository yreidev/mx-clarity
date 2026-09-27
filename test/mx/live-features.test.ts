/**
 * 邮件订阅、AI 精读、朗读、站长「此刻」、实时提醒、阅读位置
 */
import type { RelayState } from '../../app/utils/mx/live'
import { describe, expect, it } from 'vitest'
import { createLiveDeskSource, liveDeskFrom, loadLiveDeskState, ownerStatusFrom } from '../../app/utils/mx/companion'
import { withWindowTitlePolicy } from '../../app/utils/mx/home'
import { loadInsights, parseInsightsContent, renderInsights } from '../../app/utils/mx/insights'
import { coreAckOf, coreEventOf, presenceListOf, presenceReportOf, relayCoreFrame, roomFrame } from '../../app/utils/mx/live'
import { parseSubscribe, subscribeStatusFrom } from '../../app/utils/mx/subscribe'
import { ttsSegmentsFrom } from '../../app/utils/mx/tts'
import { clientWith, fixture, jsonResponse } from './helpers'

const ROOM = '183590000000000001'
const frames = fixture<{ event: string, payload: Record<string, unknown> }[]>('ws-frames')
const commentPayload = frames.find(frame => frame.event === 'comment.create')!.payload
const frame = (event: string, payload: unknown) => JSON.stringify({ v: 1, event, payload })
const mask = (identity: string) => `m-${identity}`
const roomState = (extra: Partial<RelayState> = {}): RelayState => ({ room: ROOM, identity: 'self0000', maskIdentity: mask, comments: {}, ...extra })

describe('中继：先认事件名', () => {
	it('帧头的事件名；键的顺序不对、不是信封的认不出（按丢弃处理）', () => {
		expect(coreEventOf('{"v":1,"event":"visitor.online","payload":{}}')).toBe('visitor.online')
		expect(coreEventOf('{"event":"visitor.online","v":1}')).toBeUndefined()
		expect(relayCoreFrame('{"event":"visitor.online","v":1,"payload":{"online":3}}')).toBeUndefined()
	})

	it('发布类事件只下发信号，不解析整帧：再大、带着加密日记全文也只是 published', () => {
		const big = frame('note.create', { id: '1', password: null, hasPassword: true, text: '只给自己看的日记'.repeat(20_000), location: '某地', coordinates: { lat: 1, lng: 2 } })
		expect(big.length).toBeGreaterThan(100_000)
		for (const event of ['post.create', 'post.republish', 'note.create', 'note.republish'])
			expect(relayCoreFrame(big.replace('note.create', event)), event).toEqual({ type: 'published' })
		expect(relayCoreFrame(frame('post.update', { id: '1' }))).toBeUndefined()
		expect(relayCoreFrame(frame('page.create', { id: '1' }))).toBeUndefined()
	})
})

describe('中继：新评论', () => {
	it('当前房间的：重新组装，邮箱、IP、UA、归属地、读者 id 都不下发', () => {
		const payload = { ...commentPayload, ip: '203.0.113.9', agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', location: 'ChinaGuangdongShenzhen', countryCode: 'CN', readerId: 'reader-1' }
		const message = relayCoreFrame(frame('comment.create', payload), roomState({ comments: { showAgent: true } }))
		expect(message).toMatchObject({ type: 'comment', comment: { id: commentPayload.id, author: '示例读者' } })
		const raw = JSON.stringify(message)
		for (const leaked of ['reader@example.test', '203.0.113.9', 'Chrome', 'Shenzhen', '深圳', 'reader-1', '中国'])
			expect(raw, leaked).not.toContain(leaked)
		expect(message).not.toHaveProperty('rootId')
	})

	it('回复带上楼层 id；别的房间、悄悄话、垃圾评论、已删除、没进房间、没配映射的都不转', () => {
		const reply = { ...commentPayload, id: '184872548264054785', rootCommentId: '184872548264054784', parentCommentId: '184872548264054784' }
		expect(relayCoreFrame(frame('comment.create', reply), roomState())).toMatchObject({ type: 'comment', rootId: '184872548264054784' })
		const dropped: [string, unknown, RelayState][] = [
			['别的房间', { ...commentPayload, refId: '9' }, roomState()],
			['悄悄话', { ...commentPayload, isWhispers: true }, roomState()],
			['垃圾评论', { ...commentPayload, state: 2 }, roomState()],
			['已删除', { ...commentPayload, isDeleted: true }, roomState()],
			['坏 id', { ...commentPayload, id: '../x' }, roomState()],
			['没进房间', commentPayload, roomState({ room: undefined })],
			['没配映射', commentPayload, roomState({ comments: undefined })],
		]
		for (const [label, payload, state] of dropped)
			expect(relayCoreFrame(frame('comment.create', payload), state), label).toBeUndefined()
	})

	it('删除只转 id', () => {
		expect(relayCoreFrame(frame('comment.delete', { id: '184872548264054784', mail: 'x@example.test' }))).toEqual({ type: 'comment-delete', id: '184872548264054784' })
		expect(relayCoreFrame(frame('comment.delete', { id: 'x' }))).toBeUndefined()
	})
})

describe('中继：阅读位置', () => {
	const presence = (extra: Record<string, unknown> = {}) => ({
		identity: 'OTHER-1',
		roomName: `article-${ROOM}`,
		position: 42,
		displayName: '小明',
		sid: 'secret-session-id',
		readerId: 'reader-9',
		image: 'https://tracker.example.test/a.png',
		reader: { id: 'reader-9', name: '小明', image: 'https://tracker.example.test/a.png', handle: 'xm' },
		operationTime: 1,
		updatedAt: 2,
		connectedAt: 3,
		joinedAt: 4,
		...extra,
	})

	it('只转标识（服务端再做一次掩码）、位置、名字；sid、读者、头像、时间一概不转', () => {
		const message = relayCoreFrame(frame('activity.update_presence', presence()), roomState())
		expect(message).toEqual({ type: 'presence', identity: 'm-other-1', position: 42, name: '小明' })
		expect(JSON.stringify(message)).not.toMatch(/secret-session-id|reader-9|tracker/)
	})

	it('自己的、别的房间的丢掉；位置夹在 0–100；名字去控制字符、限长，与站长同名的写成匿名', () => {
		expect(relayCoreFrame(frame('activity.update_presence', presence({ identity: 'self0000' })), roomState())).toBeUndefined()
		expect(relayCoreFrame(frame('activity.update_presence', presence({ roomName: 'article-9' })), roomState())).toBeUndefined()
		expect(relayCoreFrame(frame('activity.update_presence', presence()), roomState({ maskIdentity: undefined }))).toBeUndefined()
		expect(relayCoreFrame(frame('activity.update_presence', presence({ position: 150 })), roomState())).toMatchObject({ position: 100 })
		expect(relayCoreFrame(frame('activity.update_presence', presence({ position: -3 })), roomState())).toMatchObject({ position: 0 })
		expect(relayCoreFrame(frame('activity.update_presence', presence({ displayName: '\u202E站长\u0000' })), roomState({ ownerName: '站长' }))).toMatchObject({ name: '匿名' })
		expect(relayCoreFrame(frame('activity.update_presence', presence({ displayName: '长'.repeat(30) })), roomState())).toMatchObject({ name: '长'.repeat(20) })
		expect(relayCoreFrame(frame('activity.update_presence', presence({ displayName: undefined })), roomState())).toMatchObject({ name: '匿名' })
	})

	it('离开只转掩码后的标识；初始列表同样的规则', () => {
		expect(relayCoreFrame(frame('activity.leave_presence', { identity: 'other-1', roomName: `article-${ROOM}` }), roomState())).toEqual({ type: 'presence-leave', identity: 'm-other-1' })
		expect(relayCoreFrame(frame('activity.leave_presence', { identity: 'self0000', roomName: `article-${ROOM}` }), roomState())).toBeUndefined()
		const list = presenceListOf({ presence: { 'other-1': presence(), 'self0000': presence({ identity: 'self0000' }), 'x': 'bad' }, readers: {} }, roomState())
		expect(list).toEqual({ type: 'presence-list', items: [{ identity: 'm-other-1', position: 42, name: '小明' }] })
	})

	it('上报的请求体：会话 id 只进 sid，昵称空的、与站长同名的不带', () => {
		expect(presenceReportOf({ identity: 'abcd', room: ROOM, sid: 'sid-1', position: 30, name: ' 小红 ', now: 5 }))
			.toEqual({ identity: 'abcd', roomName: `article-${ROOM}`, sid: 'sid-1', position: 30, ts: 5, displayName: '小红' })
		expect(presenceReportOf({ identity: 'abcd', room: ROOM, sid: 'sid-1', position: 30, name: '站长', ownerName: '站长', now: 5 })).not.toHaveProperty('displayName')
		expect(presenceReportOf({ identity: 'abcd', room: ROOM, sid: 'sid-1', position: 30, now: 5 })).not.toHaveProperty('displayName')
	})

	it('进房间带信封 id，core 回的 ack 认得出来', () => {
		expect(JSON.parse(roomFrame('room.join', '42', 'join-1'))).toEqual({ v: 1, event: 'room.join', payload: { room: 'article-42' }, id: 'join-1' })
		expect(coreAckOf('{"v":1,"event":"ack","payload":{"ok":true},"id":"join-1"}')).toEqual({ id: 'join-1', ok: true })
		expect(coreAckOf('{"v":1,"event":"ack","payload":{"ok":false,"code":"ROOM_INVALID"},"id":"join-1"}')).toEqual({ id: 'join-1', ok: false })
		expect(coreAckOf('{"v":1,"event":"ack","payload":{"ok":true}}')).toBeUndefined()
		expect(coreAckOf(frame('visitor.online', { online: 1 }))).toBeUndefined()
		expect(relayCoreFrame('{"v":1,"event":"ack","payload":{"ok":true},"id":"join-1"}')).toBeUndefined()
	})
})

describe('中继：译文与站长「此刻」', () => {
	it('译文更新只从帧头取 refId 与语言；标题里伪造的键匹配不到（JSON 字符串里的引号是转义过的）', () => {
		const text = '译文'.repeat(100_000)
		const real = JSON.stringify({ v: 1, event: 'translation.update', payload: { title: '"refId":"999","lang":"xx"', id: '7', refId: ROOM, refType: 'post', lang: 'en', sourceLang: 'zh', text } })
		expect(relayCoreFrame(real, roomState())).toEqual({ type: 'translation', refId: ROOM, lang: 'en' })
		expect(relayCoreFrame(real, roomState({ room: '999' }))).toBeUndefined()
		expect(relayCoreFrame(frame('translation.create', { id: '7', refId: ROOM, lang: '../x' }), roomState())).toBeUndefined()
	})

	const state = (extra: Record<string, unknown> = {}) => ({
		epoch: 'e1',
		revision: 3,
		projection: {
			availability: 'active',
			expiresAt: '2999-01-01T00:00:00.000Z',
			application: { displayName: 'VS Code', window: { title: 'secret.ts — 私密项目' }, activity: { customLabel: '写代码' }, iconUrl: 'https://tracker.example.test/i.png' },
			media: { kind: 'music', title: '一首歌', artist: '某人', album: '专辑', artworkUrl: 'https://tracker.example.test/c.png', playback: { state: 'playing' } },
		},
		...extra,
	})

	it('站长「此刻」：没开不转；开了只给文字，窗口标题默认不给，同一版本的重放丢掉', () => {
		expect(relayCoreFrame(frame('companion_presence.changed', state()), roomState())).toBeUndefined()
		const relay: RelayState = { liveDesk: { showWindowTitle: false } }
		const first = relayCoreFrame(frame('companion_presence.changed', state()), relay)
		expect(first).toMatchObject({ type: 'live-desk', desk: { app: { name: 'VS Code', label: '写代码' }, media: { title: '一首歌', artist: '某人', playing: true } } })
		expect(JSON.stringify(first)).not.toMatch(/secret|tracker/)
		expect(relayCoreFrame(frame('companion_presence.changed', state()), relay)).toBeUndefined()
		expect(relayCoreFrame(frame('companion_presence.changed', state({ revision: 2 })), relay)).toBeUndefined()
		expect(relayCoreFrame(frame('companion_presence.changed', state({ revision: 4, projection: { availability: 'idle' } })), relay)).toEqual({ type: 'live-desk', desk: null })
		// core 重启后 epoch 换了，revision 从头来
		expect(relayCoreFrame(frame('companion_presence.changed', state({ epoch: 'e2', revision: 0 })), relay)).toMatchObject({ type: 'live-desk' })
	})

	it('liveDeskFrom：开了 showWindowTitle 才有窗口标题；过期的当没有', () => {
		expect(liveDeskFrom(state(), { showWindowTitle: true })?.app?.window).toBe('secret.ts — 私密项目')
		expect(liveDeskFrom(state({ projection: { ...state().projection, expiresAt: '2000-01-01T00:00:00.000Z' } }))).toBeNull()
		expect(liveDeskFrom({ projection: { availability: 'active' } })).toBeNull()
	})

	it('经 HTTP 取的「此刻」：转 companion/presence/public，取 data.state', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { state: state() } }))
		expect(liveDeskFrom(await loadLiveDeskState(client))).toMatchObject({ app: { name: 'VS Code' } })
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/companion/presence/public')
	})

	it('站长状态：表情 8 字、描述 60 字，过期的是 null；untilAt 秒与毫秒都认', () => {
		const now = Date.parse('2026-09-25T00:00:00Z')
		expect(ownerStatusFrom({ emoji: '☕', desc: '在喝咖啡', untilAt: now / 1000 + 60 }, now)).toEqual({ emoji: '☕', desc: '在喝咖啡', untilAt: new Date(now + 60_000).toISOString() })
		expect(ownerStatusFrom({ data: { emoji: '☕', desc: '在喝咖啡', untilAt: now + 60_000 } }, now)?.untilAt).toBe(new Date(now + 60_000).toISOString())
		expect(ownerStatusFrom({ emoji: '☕', desc: '过期了', untilAt: now - 1 }, now)).toBeNull()
		expect(ownerStatusFrom({ desc: 'x'.repeat(100) }, now)?.desc).toHaveLength(60)
		expect(ownerStatusFrom(null, now)).toBeNull()
	})

	it('碎碎念情境里的窗口标题跟 showWindowTitle 走', () => {
		const item = { context: { app: 'VS Code', window: 'secret.ts' } }
		expect(withWindowTitlePolicy(item, false)).toEqual({ context: { app: 'VS Code' } })
		expect(withWindowTitlePolicy(item, true)).toBe(item)
		expect(withWindowTitlePolicy({ context: { window: 'secret.ts' } }, false)).toEqual({ context: undefined })
	})
})

describe('邮件订阅', () => {
	it('类型只取 core 允许的与文章、日记的交集；都没有就当没开', () => {
		expect(subscribeStatusFrom({ enable: true, allowTypes: ['post_c', 'say_c', 'note_c'] })).toEqual({ enable: true, types: ['post_c', 'note_c'] })
		expect(subscribeStatusFrom({ enable: true, allowTypes: ['say_c'] })).toEqual({ enable: false, types: [] })
		expect(subscribeStatusFrom({ enable: false, allowTypes: ['post_c'] })).toMatchObject({ enable: false })
	})

	it('邮箱照评论的规则，类型只收允许的', () => {
		expect(parseSubscribe({ email: 'A@Example.test', types: ['post_c'] })).toEqual({ email: 'a@example.test', types: ['post_c'] })
		expect(typeof parseSubscribe({ email: 'bad', types: ['post_c'] })).toBe('string')
		expect(typeof parseSubscribe({ email: 'a@example.test', types: ['say_c'] })).toBe('string')
		expect(typeof parseSubscribe({ email: 'a@example.test', types: [] })).toBe('string')
		expect(typeof parseSubscribe({ email: 'a@example.test', types: ['note_c'] }, ['post_c'])).toBe('string')
	})
})

describe('精读（AI 洞察）', () => {
	it('只读库里的（onlyDb），从不请求生成', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { content: '# 精读\n\n正文', isTranslation: false } }))
		expect(await loadInsights(client, '42')).toMatchObject({ status: 'ready' })
		const url = new URL(requests[0]!.url)
		expect(url.pathname).toBe('/api/v3/ai/insights/article/42')
		expect(url.searchParams.get('onlyDb') ?? url.searchParams.get('only_db')).toBe('true')
		expect(requests.some(request => /generate|stream/.test(request.url))).toBe(false)
	})

	it('null 是还没有；403 是要解锁；400 是没有', async () => {
		expect(await loadInsights(clientWith(() => jsonResponse({ data: null })).client, '42')).toEqual({ status: 'none' })
		expect(await loadInsights(clientWith(() => jsonResponse({ error: { code: 'FORBIDDEN' } }, { status: 403 })).client, '42')).toEqual({ status: 'locked' })
		expect(await loadInsights(clientWith(() => jsonResponse({ error: { code: 'INVALID' } }, { status: 400 })).client, '42')).toEqual({ status: 'none' })
	})

	it('去掉末尾的 meta 注释，引用换成 insight-ref；属性是纯文本、限长', async () => {
		const content = '要点<ref quote="原文 &quot;一段&quot;" section="第一节"/>继续\n\n```js\nconst a = \'<ref quote="代码里的"/>\'\n```\n\n<!-- insights-meta: {"reading_time_min": 7, "difficulty": "hard"} -->'
		const { refs, meta, markdown } = parseInsightsContent(content)
		expect(meta).toEqual({ readingMinutes: 7, difficulty: 'hard' })
		expect(markdown).not.toContain('insights-meta')
		expect(refs[0]).toEqual({ quote: '原文 "一段"', section: '第一节' })
		const { body } = await renderInsights(content)
		const raw = JSON.stringify(body)
		expect(raw).toContain('"tag":"insight-ref"')
		expect(raw).toContain('原文 \\"一段\\"')
		expect(raw).not.toMatch(/\uE000|\uE001/)
		expect(parseInsightsContent(`<ref quote="${'长'.repeat(300)}"/>`).refs[0]!.quote).toHaveLength(120)
	})
})

describe('朗读', () => {
	it('只留 https 与本站路径的音频；文字是纯文本', () => {
		const segments = ttsSegmentsFrom({ model: 'x', voice: 'y', segments: [
			{ text: '第一段', url: 'https://cdn.example.test/1.mp3' },
			{ text: '第二段', url: '/objects/2.mp3' },
			{ text: '坏的', url: 'javascript:alert(1)' },
			{ text: '坏的', url: '//evil.example/3.mp3' },
			{ text: '坏的', url: 'http://plain.example/4.mp3' },
		] })
		expect(segments).toEqual([{ text: '第一段', url: 'https://cdn.example.test/1.mp3' }, { text: '第二段', url: '/objects/2.mp3' }])
		expect(JSON.stringify(segments)).not.toMatch(/model|voice/)
	})
})

describe('中继：这一篇的更新、删除与评论编辑（§28.2）', () => {
	it('更新只下发信号，不解析整帧；只认当前房间、id 在 payload 的第一个字段', () => {
		const big = JSON.stringify({ v: 1, event: 'post.update', payload: { id: ROOM, title: '改过的标题', text: '全文'.repeat(50_000), meta: { secret: 1 } } })
		expect(big.length).toBeGreaterThan(64 * 1024)
		for (const event of ['post.update', 'note.update', 'page.update'])
			expect(relayCoreFrame(big.replace('post.update', event), roomState()), event).toEqual({ type: 'content-updated', id: ROOM })
		expect(relayCoreFrame(big, roomState({ room: '9' }))).toBeUndefined()
		expect(relayCoreFrame(big, roomState({ room: undefined }))).toBeUndefined()
		// id 不在最前面（或者只在嵌套对象里）认不出，按丢弃处理
		expect(relayCoreFrame(JSON.stringify({ v: 1, event: 'post.update', payload: { title: 'x', category: { id: ROOM } } }), roomState())).toBeUndefined()
	})

	it('删除、下线：payload 是 id 字符串，对上当前房间才下发', () => {
		for (const event of ['post.delete', 'post.unpublish', 'note.delete', 'note.unpublish', 'page.delete'])
			expect(relayCoreFrame(frame(event, ROOM), roomState()), event).toEqual({ type: 'content-removed', id: ROOM })
		expect(relayCoreFrame(frame('post.delete', '9'), roomState())).toBeUndefined()
		expect(relayCoreFrame(frame('post.delete', { id: ROOM }), roomState())).toBeUndefined()
	})

	it('评论被改：正文照评论的白名单重新渲染，不带原文；举报推送、坏 id 不转', () => {
		const message = relayCoreFrame(frame('comment.update', { id: '184872548264054784', text: '改成**加粗**<script>alert(1)</script>' }), roomState({ now: () => Date.parse('2026-09-25T00:00:00Z') }))
		expect(message).toMatchObject({ type: 'comment-edit', id: '184872548264054784', editedAt: '2026-09-25T00:00:00.000Z' })
		// 加粗渲染成节点；标签只是纯文本（页面上按文字转义显示），不会成为元素
		const raw = JSON.stringify(message)
		expect(raw).toContain('"type":"strong"')
		expect(raw).not.toContain('**')
		expect(raw).toContain('"type":"text","value":"<script>alert(1)</script>"')
		expect(relayCoreFrame(frame('comment.update', { id: '184872548264054784', reported: true }), roomState())).toBeUndefined()
		expect(relayCoreFrame(frame('comment.update', { id: 'x', text: 'y' }), roomState())).toBeUndefined()
		expect(relayCoreFrame(frame('comment.update', { id: '184872548264054784', text: 'y' }), roomState({ comments: undefined }))).toBeUndefined()
	})
})

describe('「此刻」的全站缓存与按版本号回源', () => {
	/** 假时钟：sleep 直接把时间往后拨；core 每回源一次版本号就是当时的 `revision` */
	function setup() {
		let t = 0
		let revision = 1
		const loads: number[] = []
		const sleeps: number[] = []
		const stateFor = createLiveDeskSource({
			load: async () => {
				loads.push(t)
				return { epoch: 'e', revision }
			},
			now: () => t,
			sleep: async (ms) => {
				sleeps.push(ms)
				t += ms
			},
		})
		const advance = (ms: number) => {
			t += ms
		}
		const publish = (next: number) => {
			revision = next
		}
		return { stateFor, loads, sleeps, advance, publish }
	}

	it('缓存期内直接给缓存的；推送的版本号不比缓存新也不回源', async () => {
		const { stateFor, loads, advance } = setup()
		await stateFor()
		advance(5000)
		expect(await stateFor()).toEqual({ epoch: 'e', revision: 1 })
		expect(await stateFor('e:1')).toEqual({ epoch: 'e', revision: 1 })
		expect(loads).toHaveLength(1)
		advance(15_000)
		await stateFor()
		expect(loads).toHaveLength(2)
	})

	it('站长 2 秒内连着变两次：第二次等到间隔过去再回源，拿到的是新的，不是旧的', async () => {
		const { stateFor, loads, sleeps, advance, publish } = setup()
		await stateFor()
		publish(2)
		expect(await stateFor('e:2')).toEqual({ epoch: 'e', revision: 2 })
		advance(500)
		publish(3)
		expect(await stateFor('e:3')).toEqual({ epoch: 'e', revision: 3 })
		expect(sleeps).toEqual([1500])
		expect(loads).toEqual([0, 0, 2000])
	})

	it('同时来的请求只回源一次', async () => {
		const { stateFor, loads, publish } = setup()
		await stateFor()
		publish(2)
		const states = await Promise.all([stateFor('e:2'), stateFor('e:2'), stateFor('e:2')])
		expect(states).toEqual(Array.from({ length: 3 }, () => ({ epoch: 'e', revision: 2 })))
		expect(loads).toHaveLength(2)
	})

	it('版本号是乱填的（永远比 core 的新）：每 2 秒最多回源一次，等几轮还不行就给现有的', async () => {
		const { stateFor, loads } = setup()
		await stateFor()
		for (let i = 0; i < 5; i++)
			expect(await stateFor('e:999')).toEqual({ epoch: 'e', revision: 1 })
		const gaps = loads.slice(1).map((at, i) => at - loads[i]!)
		expect(gaps.every(gap => gap >= 2000 || gap === 0)).toBe(true)
		expect(await stateFor('bad')).toEqual({ epoch: 'e', revision: 1 })
	})
})
