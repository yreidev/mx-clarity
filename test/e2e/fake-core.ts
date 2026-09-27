/**
 * 页面级测试用的假 core：按路径返回 test/fixtures/mx 的夹具，记下每个请求（方法、路径、请求头），
 * 另带一个接受任何升级的 WebSocket（浏览器直连的实时网关）：记下连上来的地址与收到的帧，带信封 id 的 `room.join`、`ping` 照 core 回 ack，
 * 测试可以往所有连接推帧。没对上的路径回 404，与 core 的信封一致。
 */
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

export interface CoreRequest {
	method: string
	/** 去掉 `/api/v3` 前缀的路径，带查询参数 */
	path: string
	headers: Record<string, string | string[] | undefined>
	/** 请求体原文（没有时为空串） */
	body: string
}

/** `handle` 的回复：`status` 默认 200，`body` 原样 JSON 序列化；204 不带内容；给了 `raw` 就按 `type`（默认纯文本）原样回 */
export interface CoreReply {
	status?: number
	body?: unknown
	raw?: string
	type?: string
	headers?: Record<string, string>
}

export interface FakeCore {
	/** 给主题的 NUXT_MX_API_URL，带 `/api/v3` */
	apiUrl: string
	requests: CoreRequest[]
	/** 中继连上来的 WebSocket：地址（含 socket_session_id）与请求头 */
	wsConnections: { url: string, headers: Record<string, string | string[] | undefined> }[]
	/** WebSocket 收到的帧（原文） */
	wsFrames: string[]
	/** 往所有连着的 WebSocket 推一帧（对象按 core 的信封序列化） */
	broadcast: (frame: unknown) => void
	close: () => Promise<void>
}

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))

/** 跨年边上的一篇：UTC 2022-12-31 20:00，在东八区已是 2023 年元旦 */
export const EDGE_POST_TITLE = '跨年边上的一篇'

function postsPage() {
	const page = fixture('posts-page')
	Object.assign(page.data[0], { created_at: '2022-12-31T20:00:00.000Z', modified_at: null, title: EDGE_POST_TITLE })
	return page
}

/**
 * 语法示例：前面加一个 B 站视频（文末是故意写的未知块，加在后面会被并进去）；
 * 带上 admin 里的预设（公告、AI 参与声明）与 core 算好的 `$meta`（相关文章、AI 摘要、Skill）。线格式是下划线命名
 */
function syntaxPost() {
	const post = fixture('post-syntax-sample')
	post.data.text = `::video-embed{type="bilibili" id="BV1xx411c7mD"}\n::\n\n${post.data.text}`
	// 放到 2022 年：看得到「可能已过时」
	Object.assign(post.data, { created_at: '2022-06-01T00:00:00.000Z', modified_at: '2022-06-01T00:00:00.000Z' })
	post.data.meta = { ...post.data.meta, banner: { type: 'warning', message: '示例公告：这是站长设在文章上的提示。', class_name: 'evil' }, ai_gen: [1, 5] }
	Object.assign(post.meta, {
		related: [{ id: '186000000000000101', title: '相关的示例文章', slug: 'xss-probe', summary: '另一篇示例', category: { name: '技术', slug: 'tech' } }],
		summary: { id: '1', text: '这是一段示例的 AI 摘要。', lang: 'zh', created_at: '2022-01-01T00:00:00.000Z' },
		skills: [{ id: '2', name: 'demo-skill', description: '示例 Skill', raw_url: 'https://blog.example.com/api/v3/s/sk/demo/SKILL.md', assets: [] }],
	})
	return post
}

/** 日记带封面与 AI 摘要 */
function noteDetail() {
	const note = fixture('note-detail')
	note.data.meta = { ...note.data.meta, cover: 'https://example.com/note-cover.png' }
	note.meta.summary = { id: '3', text: '示例日记的 AI 摘要。', lang: 'zh', created_at: '2022-01-01T00:00:00.000Z' }
	return note
}

/** 第一条碎碎念引用一篇日记，并且是 companion 发布的 */
function recentlyList() {
	const list = fixture('recently-list')
	Object.assign(list.data[0], {
		ref: { id: '184834950644633600', type: 'note', title: '示例日记', url: '/notes/2' },
		metadata: { kind: 'companion-moment', application: { display_name: 'VS Code', window: { title: 'README.md' } }, media: { title: '示例曲目', artist: '示例歌手' } },
	})
	return list
}

/** 专栏描述是 markdown */
function topicDetail() {
	const topic = fixture('topic-detail')
	topic.data.description = '这个专栏的描述带**加粗**。'
	return topic
}

export interface FakeCoreOptions {
	/** 主题配置片段；不给就是 404（和没建片段一样） */
	theme?: unknown
	/** 这些路径慢 800 毫秒再回（看站内跳转时的加载状态） */
	slow?: RegExp
	/** 先问它；返回 `undefined` 再按固定的夹具路由走 */
	handle?: (request: CoreRequest) => CoreReply | undefined
}

export async function startFakeCore(options: FakeCoreOptions = {}): Promise<FakeCore> {
	const routes: [RegExp, () => unknown][] = [
		[/^\/ping$/, () => ({ data: 'pong' })],
		[/^\/info$/, () => ({ data: { name: '@mx-space/core', version: '14.13.0' } })],
		[/^\/aggregate\/site$/, () => fixture('aggregate-site')],
		[/^\/aggregate\/site_info$/, () => fixture('site-info')],
		[/^\/aggregate\/timeline$/, () => fixture('timeline')],
		[/^\/aggregate\/sitemap$/, () => fixture('sitemap')],
		// 带 ?theme= 时 core 在 theme 里给主题配置片段（这里就是 options.theme），没有片段时不带
		[/^\/aggregate$/, () => ({ data: { ...fixture('aggregate').data, theme: options.theme } })],
		[/^\/owner$/, () => fixture('owner')],
		...(options.theme ? [[/^\/s\/theme\/mx-clarity$/, () => options.theme] as [RegExp, () => unknown]] : []),
		[/^\/posts\/tech\/mx-syntax-sample$/, syntaxPost],
		[/^\/posts\/tech\/xss-probe$/, () => fixture('post-xss-probe')],
		[/^\/posts$/, postsPage],
		[/^\/notes\/nid\/\d+$/, noteDetail],
		[/^\/notes\/2022\/5\/1\/hello$/, noteDetail],
		[/^\/notes/, () => fixture('notes-page')],
		[/^\/topics\/.+/, topicDetail],
		[/^\/recently\/\d+$/, () => fixture('recently-item')],
		[/^\/recently/, recentlyList],
		[/^\/says/, () => fixture('says-page')],
		[/^\/links\/all$/, () => fixture('links-all')],
		[/^\/pages\/slug\/about$/, () => fixture('page-about')],
		[/^\/pages/, () => fixture('pages-list')],
		[/^\/search/, () => fixture('search-all')],
		[/^\/projects/, () => fixture('projects-all')],
		[/^\/comments\/ref\//, () => fixture('comments-ref')],
		[/^\/comments\/thread\//, () => fixture('comments-thread')],
		[/^\/activity\/rooms/, () => fixture('activity-rooms')],
		// 页脚要看站长开没开会员；真实的 core 总会回方案（没开时 enabled 为假）
		[/^\/membership\/plans$/, () => fixture('membership-plans')],
	]
	const requests: CoreRequest[] = []
	const server = createServer((req, res) => {
		const chunks: Buffer[] = []
		req.on('data', chunk => chunks.push(chunk))
		req.on('end', () => {
			const url = new URL(req.url ?? '/', 'http://core')
			const path = url.pathname.replace(/^\/api\/v3/, '')
			const request = { method: req.method ?? 'GET', path: path + url.search, headers: req.headers, body: Buffer.concat(chunks).toString() }
			requests.push(request)
			const custom = options.handle?.(request)
			const route = routes.find(([pattern]) => pattern.test(path))
			const reply = () => {
				if (custom) {
					const status = custom.status ?? 200
					if (custom.raw !== undefined) {
						res.writeHead(status, { 'content-type': custom.type ?? 'text/plain', ...custom.headers })
						res.end(custom.raw)
						return
					}
					res.writeHead(status, status === 204 ? { ...custom.headers } : { 'content-type': 'application/json', ...custom.headers })
					res.end(status === 204 ? undefined : JSON.stringify(custom.body ?? null))
					return
				}
				res.writeHead(route ? 200 : 404, { 'content-type': 'application/json' })
				res.end(JSON.stringify(route ? route[1]() : { error: { code: 'NOT_FOUND', message: 'Not found' } }))
			}
			if (options.slow?.test(path))
				setTimeout(reply, 800)
			else
				reply()
		})
	})
	const sockets = new WebSocketServer({ server })
	const wsConnections: FakeCore['wsConnections'] = []
	const wsFrames: string[] = []
	sockets.on('connection', (socket, req) => {
		wsConnections.push({ url: req.url ?? '', headers: req.headers })
		socket.on('message', (data) => {
			const raw = String(data)
			wsFrames.push(raw)
			try {
				const frame = JSON.parse(raw) as { event?: string, id?: string }
				if ((frame.event === 'room.join' || frame.event === 'ping') && frame.id)
					socket.send(JSON.stringify({ v: 1, event: 'ack', payload: { ok: true }, id: frame.id }))
			}
			catch {}
		})
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	return {
		apiUrl: `http://127.0.0.1:${port}/api/v3`,
		requests,
		wsConnections,
		wsFrames,
		broadcast: (frame) => {
			const raw = typeof frame === 'string' ? frame : JSON.stringify(frame)
			for (const client of sockets.clients)
				client.send(raw)
		},
		close: () => new Promise((resolve) => {
			for (const client of sockets.clients)
				client.terminate()
			sockets.close()
			server.close(() => resolve())
			server.closeAllConnections()
		}),
	}
}
