/**
 * api-client 用法探针
 *
 * 校验主题对 api-client 的全部假设（导入路径、调用形态、请求 URL、响应格式、适配器配置）。升级 @mx-space/api-client 后必须重跑：
 *   pnpm probe:api
 *
 * 不发真实网络请求：用假适配器拦截并记录 URL。
 * 退出码 0 表示假设都成立，1 表示有断言失效——此时先弄清变化，再改代码。
 */

import process from 'node:process'
import { allControllerNames, allControllers, createClient, metaFor, simpleCamelcaseKeys } from '@mx-space/api-client'

const EXPECTED_VERSION = '5.12.0'
const ENDPOINT = 'https://api.example.com/api/v3' // 生产前缀 /api/v3（API_VERSION=3）；core 以开发模式运行时无前缀

const failures = []
const notes = []

function check(name, actual, expected) {
	if (actual === expected) {
		console.log(`  \x1B[32m✓\x1B[39m ${name}`)
	}
	else {
		console.log(`  \x1B[31m✗\x1B[39m ${name}`)
		console.log(`      期望: ${expected}`)
		console.log(`      实际: ${actual}`)
		failures.push(name)
	}
}

// ---------- 导入路径 ----------

console.log('\n导入路径')

try {
	await import('@mx-space/api-client/adaptors/fetch')
	console.log('  \x1B[33m!\x1B[39m readme 路径 /adaptors/fetch 现在可用了 —— 这条陷阱说明可以删除')
	notes.push('readme 路径已修复，导入路径的说明可以更新')
}
catch {
	console.log('  \x1B[32m✓\x1B[39m /adaptors/fetch 仍不可用（陷阱仍在）')
}

const { fetchAdaptor } = await import('@mx-space/api-client/dist/adaptors/fetch')
check('/dist/adaptors/fetch 导出 fetchAdaptor', typeof fetchAdaptor, 'object')

const { version } = await import('@mx-space/api-client/package.json', { with: { type: 'json' } })
	.then(m => m.default)
	.catch(() => ({ version: '未知' }))
if (version !== EXPECTED_VERSION) {
	console.log(`  \x1B[33m!\x1B[39m 版本变化: 锁定 ${EXPECTED_VERSION}，当前 ${version}`)
	notes.push(`版本从 ${EXPECTED_VERSION} 变为 ${version}`)
}

// ---------- 假适配器 ----------

const calls = []
function record(method) {
	return async (url, options) => {
		const params = options?.params
			? `?${new URLSearchParams(Object.entries(options.params).filter(([, v]) => v !== undefined))}`
			: ''
		calls.push(`${method.toUpperCase()} ${url.replace(ENDPOINT, '')}${params}`)
		return { data: {} }
	}
}
const mockAdaptor = {
	get: record('get'),
	post: record('post'),
	put: record('put'),
	patch: record('patch'),
	delete: record('delete'),
	default: null,
	responseWrapper: {},
}

const client = createClient(mockAdaptor)(ENDPOINT)
client.injectControllers(allControllers)

/** 调用一次并返回它实际打出的请求行 */
async function urlOf(fn) {
	calls.length = 0
	await fn()
	return calls.join(' | ')
}

// ---------- 调用形态 ----------

console.log('\n调用形态')
check('controller 数量', allControllerNames.length, 26)
check('client.post 是一层而非 client.post.post', typeof client.post?.getList, 'function')
check('client.post.post 不存在', typeof client.post?.post, 'undefined')

// ---------- 已封装方法 ----------

console.log('\n已封装方法的请求 URL')

const wrapped = [
	['post.getList', () => client.post.getList(2, 10, { sortBy: 'createdAt', sortOrder: -1 }), 'GET /posts?page=2&size=10&sortBy=createdAt&sortOrder=-1'],
	['post.getPost', () => client.post.getPost('tech', 'hello-world'), 'GET /posts/tech/hello-world'],
	['note.getList', () => client.note.getList(1, 10), 'GET /notes?page=1&size=10'],
	['note.getNoteByNid', () => client.note.getNoteByNid(42), 'GET /notes/nid/42'],
	['page.getBySlug', () => client.page.getBySlug('about'), 'GET /pages/slug/about'],
	['category.getAllCategories', () => client.category.getAllCategories(), 'GET /categories?type=0'],
	['comment.getByRefId', () => client.comment.getByRefId('abc123'), 'GET /comments/ref/abc123?page=1&size=10'],
	['aggregate.getAggregateData', () => client.aggregate.getAggregateData(), 'GET /aggregate'],
	['aggregate.getTop', () => client.aggregate.getTop(), 'GET /aggregate/top?size=5'],
	['search.search', () => client.search.search('post', 'nuxt'), 'GET /search/post?keyword=nuxt'],
]

for (const [name, fn, expected] of wrapped)
	check(name, await urlOf(fn), expected)

// ---------- 基类方法（autoBind 到实例，不在 prototype 上） ----------

console.log('\n基类方法的请求 URL')

const baseMethods = [
	['say.getAll', () => client.say.getAll(), 'GET /says/all'],
	['say.getAllPaginated', () => client.say.getAllPaginated(1, 10), 'GET /says?page=1&size=10'],
	['project.getAll', () => client.project.getAll(), 'GET /projects/all'],
	['project.getById', () => client.project.getById('id'), 'GET /projects/id'],
	['link.getAll', () => client.link.getAll(), 'GET /links/all'],
	['topic.getAll', () => client.topic.getAll(), 'GET /topics/all'],
	['topic.getTopicBySlug', () => client.topic.getTopicBySlug('s'), 'GET /topics/slug/s'],
	['recently.getAll', () => client.recently.getAll(), 'GET /recently/all'],
	['recently.getList', () => client.recently.getList(), 'GET /recently'],
	['note.getMiddleList', () => client.note.getMiddleList('id', 5), 'GET /notes/list/id?size=5'],
	['note.getNoteByTopicId', () => client.note.getNoteByTopicId('tid'), 'GET /notes/topics/tid?page=1&size=10'],
	['aggregate.getTimeline', () => client.aggregate.getTimeline(), 'GET /aggregate/timeline'],
	['aggregate.getStat', () => client.aggregate.getStat(), 'GET /aggregate/stat'],
	['aggregate.getLatest', () => client.aggregate.getLatest(), 'GET /aggregate/latest'],
]

for (const [name, fn, expected] of baseMethods)
	check(name, await urlOf(fn), expected)

// ---------- proxy 兜底 ----------

console.log('\nproxy 兜底的请求 URL')

const proxied = [
	['poll（无 controller）', () => client.proxy.polls.get(), 'GET /polls'],
	['reader（无 controller）', () => client.proxy.readers.stats.get(), 'GET /readers/stats'],
]

for (const [name, fn, expected] of proxied)
	check(name, await urlOf(fn), expected)

// ---------- 假设 poll/reader 无 controller，一旦补上就该改用官方方法 ----------

console.log('\n仍缺失的 controller')

for (const [name, value] of [['client.poll', client.poll], ['client.reader', client.reader]]) {
	if (value === undefined) {
		console.log(`  \x1B[32m✓\x1B[39m ${name} 仍缺失（与假设一致）`)
	}
	else {
		console.log(`  \x1B[33m!\x1B[39m ${name} 现在存在了 —— 改用官方方法`)
		notes.push(`${name} 已补齐`)
	}
}

// ---------- 响应信封与大小写 ----------

console.log('\n响应信封与大小写')

{
	// 模拟 core 真实出站格式：snake_case + { data, meta } 信封
	const listWire = {
		data: [{ id: '1', title: 'T', created_at: '2026-01-01', is_published: true, content_format: 'markdown' }],
		meta: { pagination: { page: 1, size: 10, total: 1, total_pages: 1 }, view: 'card' },
	}
	const detailWire = {
		data: { id: '77', title: 'T', created_at: '2026-01-01' },
		meta: {
			paywall: { locked: true, preview_blocks: 3, entitlement: { reason: 'locked' } },
			summary: { id: 's', text: 'AI 摘要', lang: 'zh', created_at: '2026-01-01' },
			interaction: { is_liked: false, like_count: 5, read_count: 99 },
		},
	}
	const envAdaptor = body => ({
		get: async () => ({ data: body }),
		post: async () => ({ data: {} }),
		put: async () => ({ data: {} }),
		patch: async () => ({ data: {} }),
		delete: async () => ({ data: {} }),
		default: null,
		responseWrapper: {},
	})

	const listClient = createClient(envAdaptor(listWire))(ENDPOINT)
	listClient.injectControllers(allControllers)
	const list = await listClient.post.getList(1, 10)

	check('列表 data 是数组', Array.isArray(list.data), true)
	check('snake_case 已转 camelCase', list.data[0].createdAt, '2026-01-01')
	check('原 snake_case 键已消失', list.data[0].created_at, undefined)
	check('is_published → isPublished', list.data[0].isPublished, true)
	check('meta.pagination 提升到顶层', list.pagination?.totalPages, 1)
	check('list.meta 不可用', list.meta ?? null, null)

	const detailClient = createClient(envAdaptor(detailWire))(ENDPOINT)
	detailClient.injectControllers(allControllers)
	const detail = await detailClient.post.getPost('tech', 's')

	check('详情数据平铺在顶层', detail.title, 'T')
	check('详情 meta 在 $meta 上', detail.$meta?.paywall?.locked, true)
	check('$meta 也转了 camelCase', detail.$meta?.paywall?.previewBlocks, 3)
	check('$meta 不可枚举', Object.keys(detail).includes('$meta'), false)
	check('metaFor 需要两个参数', metaFor(detail, detail.$meta).interaction?.likeCount, 5)
	check('metaFor 少传参数会静默返回空', Object.keys(metaFor(detail)).length, 0)
}

// ---------- 适配器配置的两个坑 ----------

console.log('\n适配器配置')

{
	// 详情响应：无 meta.pagination，api-client 走「平铺」分支
	const wire = {
		data: {
			id: '1',
			title: 'T',
			enrichments: {
				'https://github.com/mx-space/core': { title: 'core', fetch_state: 'ok' },
			},
		},
	}
	// 列表响应：有 meta.pagination，api-client 走「{data, pagination}」分支
	const listWire = { data: [{ id: '1' }], meta: { pagination: { page: 1, size: 10, total: 1, total_pages: 3 } } }

	// ofetch 风格：直接返回已解包的 body
	const ofetchLike = body => ({
		default: null,
		get: async () => body,
		post: async () => body,
		put: async () => body,
		patch: async () => body,
		delete: async () => body,
		responseWrapper: {},
	})

	// 坑 1：覆盖 getDataFromResponse 会丢分页
	const bad = createClient(ofetchLike(listWire))(ENDPOINT, {
		controllers: allControllers,
		getDataFromResponse: r => r,
	})
	const badRes = await bad.post.getList(1, 10)
	check('覆盖 getDataFromResponse 会丢 pagination（勿学 Shiro）', badRes.pagination, undefined)

	const good = createClient(ofetchLike(listWire))(ENDPOINT, { controllers: allControllers })
	const goodRes = await good.post.getList(1, 10)
	check('保持默认则 pagination 正常', goodRes.pagination?.totalPages, 3)

	// 坑 2：默认 transformResponse 破坏 URL 形状的对象键
	const plain = createClient(ofetchLike(wire))(ENDPOINT, { controllers: allControllers })
	const plainRes = await plain.post.getPost('t', 's')
	check(
		'默认转换会破坏 URL 键（mx-space → mxSpace）',
		Object.keys(plainRes.enrichments ?? {})[0],
		'https://github.com/mxSpace/core',
	)

	const isUrlKey = k => /^[a-z][\w+.-]*:\/\//i.test(k)
	const fixed = createClient(ofetchLike(wire))(ENDPOINT, {
		controllers: allControllers,
		transformResponse: d => simpleCamelcaseKeys(d, { shouldSkipKey: isUrlKey }),
	})
	const fixedRes = await fixed.post.getPost('t', 's')
	check('shouldSkipKey 修复后 URL 键保持原样', Object.keys(fixedRes.enrichments ?? {})[0], 'https://github.com/mx-space/core')
	check('修复后值内部仍正常转换', fixedRes.enrichments?.['https://github.com/mx-space/core']?.fetchState, 'ok')
}

// ---------- 汇总 ----------

console.log(`\n${'─'.repeat(56)}`)
if (notes.length) {
	console.log('\n需要跟进的变化:')
	notes.forEach(n => console.log(`  · ${n}`))
}
if (failures.length) {
	console.log(`\n\x1B[31m${failures.length} 条断言失效\x1B[39m，先弄清变化再改代码:`)
	failures.forEach(f => console.log(`  · ${f}`))
	process.exit(1)
}
console.log('\n\x1B[32m全部断言成立\x1B[39m')
