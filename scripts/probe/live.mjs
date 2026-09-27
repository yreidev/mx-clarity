/**
 * 真实 core 实例探针
 *
 *   pnpm probe:live                                        # 连 .env 里 NUXT_MX_API_URL 指的 core
 *   MX_API=https://mx.example.com/api/v3 pnpm probe:live   # 临时换一个实例
 *
 * 只打只读端点，不写任何数据。
 *
 * 目的：字段映射是读源码得来的，这里对着真实实例实测一遍。
 * scripts/probe/api-client.mjs 用的是假适配器，只能证明 api-client 怎么解析响应，
 * 证明不了服务器真的这么返回。这个脚本补那道缝。
 */

import process from 'node:process'
import { allControllers, createClient, metaFor, simpleCamelcaseKeys } from '@mx-space/api-client'

// core 的地址：与开发时同一个变量（`pnpm probe:live` 会读 .env），也可以临时用 MX_API 指定
const BASE = process.env.MX_API || process.env.NUXT_MX_API_URL
if (!BASE) {
	console.error('要设 NUXT_MX_API_URL（写在 .env 里）或 MX_API，指向一个真实的 core，如 https://blog.example.com/api/v3')
	process.exit(2)
}

const g = s => `\x1B[32m${s}\x1B[39m`
const r = s => `\x1B[31m${s}\x1B[39m`
const y = s => `\x1B[33m${s}\x1B[39m`
const dim = s => `\x1B[2m${s}\x1B[22m`

const findings = []
const gaps = []

function note(level, msg) {
	const tag = { ok: g('✓'), bad: r('✗'), warn: y('!'), info: dim('·') }[level]
	console.log(`  ${tag} ${msg}`)
	if (level === 'bad')
		findings.push(msg)
}

/** ofetch 风格 + 跳过 URL 形状的键 */
const isUrlKey = k => /^[a-z][\w+.-]*:\/\//i.test(k)

const adapter = (() => {
	const call = method => async (url, options) => {
		const { params, data } = options || {}
		// 每个请求都带 ?lang=zh，进缓存键。
		// 注意 api-client 会自己把分页参数拼进 url（params 反而是 undefined），
		// 必须用 URL API 合并，手拼 '?' 会得到 ?page=1&size=5?lang=zh → 422
		const u = new URL(url)
		for (const [k, v] of Object.entries({ lang: 'zh', ...params })) {
			if (v !== undefined)
				u.searchParams.set(k, String(v))
		}
		const res = await fetch(u, {
			method: method.toUpperCase(),
			headers: data ? { 'Content-Type': 'application/json' } : undefined,
			body: data ? JSON.stringify(data) : undefined,
		})
		const text = await res.text()
		let body
		try {
			body = JSON.parse(text)
		}
		catch {
			body = text
		}
		if (!res.ok) {
			const err = new Error(`HTTP ${res.status}`)
			err.status = res.status
			err.body = body
			throw err
		}
		return body
	}
	return {
		default: null,
		get: call('get'),
		post: call('post'),
		put: call('put'),
		patch: call('patch'),
		delete: call('delete'),
		responseWrapper: {},
	}
})()

const client = createClient(adapter)(BASE, {
	controllers: allControllers,
	transformResponse: d => simpleCamelcaseKeys(d, { shouldSkipKey: isUrlKey }),
})

/** 原始 fetch，用于看未经 api-client 处理的线上格式 */
async function raw(path) {
	const res = await fetch(`${BASE}${path}`)
	const text = await res.text()
	try {
		return { status: res.status, body: JSON.parse(text) }
	}
	catch {
		return { status: res.status, body: text }
	}
}

// ═══════════════════════════════════════════════════

console.log(`\n目标: ${BASE}\n`)

// ---------- 0. 连通性 ----------

console.log('0. 连通性')
{
	const ping = await raw('/ping').catch(e => ({ status: 0, body: e.message }))
	if (ping.status === 0) {
		console.log(r(`  ✗ 连不上 ${BASE}`))
		console.log(dim(`    ${ping.body}`))
		console.log(dim('    确认 core 在跑，地址要带 /api/v3'))
		process.exit(1)
	}
	note('ok', `/ping → ${ping.status} ${JSON.stringify(ping.body).slice(0, 40)}`)

	// 如果 /api/v3 不通，试试无前缀（源码 dev 模式）
	if (ping.status === 404) {
		const root = await fetch(BASE.replace(/\/api\/v\d+$/, '/ping')).then(r2 => r2.status).catch(() => 0)
		if (root === 200) {
			note('warn', '这个实例是 dev 模式（无 /api/v3 前缀）。把 MX_API 改成不带前缀的地址')
			gaps.push('实例运行在 dev 模式，没有生产环境的 /api/v3 前缀')
		}
	}
}

// ---------- 1. 线上格式确认----------

console.log('\n1. 线上格式（绕过 api-client 看原始响应）')
{
	const { body } = await raw('/posts?page=1&size=1')
	const hasEnvelope = body && typeof body === 'object' && 'data' in body
	note(hasEnvelope ? 'ok' : 'bad', `成功响应有 { data } 信封: ${hasEnvelope}`)

	const first = Array.isArray(body?.data) ? body.data[0] : undefined
	if (!first) {
		note('warn', '没有文章，跳过字段检查。先在 admin 里发一篇')
		gaps.push('实例无文章，字段映射未验证')
	}
	else {
		const keys = Object.keys(first)
		const snake = keys.filter(k => k.includes('_'))
		const camel = keys.filter(k => /[a-z][A-Z]/.test(k))
		note(snake.length > 0 ? 'ok' : 'bad', `线上是 snake_case: 命中 ${snake.length} 个（如 ${snake.slice(0, 3).join(', ') || '无'}）`)
		if (camel.length) {
			note('warn', `同时出现 camelCase 键，假设不成立: ${camel.join(', ')}`)
			gaps.push(`响应混用大小写: ${camel.join(', ')}`)
		}
		console.log(dim(`    实际字段: ${keys.join(', ')}`))
	}

	if (body?.meta)
		console.log(dim(`    meta: ${JSON.stringify(body.meta)}`))
}

// ---------- 2. 列表：分页与字段映射----------

console.log('\n2. 文章列表（字段映射）')
let samplePost
{
	const res = await client.post.getList(1, 5).catch(e => ({ __err: e }))
	if (res.__err) {
		note('bad', `post.getList 失败: ${res.__err.message} ${JSON.stringify(res.__err.body ?? '')}`)
	}
	else {
		note(Array.isArray(res.data) ? 'ok' : 'bad', `res.data 是数组: ${Array.isArray(res.data)}`)
		note(res.pagination ? 'ok' : 'bad', `res.pagination 存在: ${JSON.stringify(res.pagination)}`)

		samplePost = res.data?.[0]
		if (!samplePost) {
			note('warn', '列表为空')
		}
		else {
			// 必有字段逐个核对类型
			const expect = [
				['title', 'string'],
				['slug', 'string'],
				['createdAt', 'string'],
				['categoryId', 'string'],
				['isPublished', 'boolean'],
			]
			for (const [field, type] of expect) {
				const actual = typeof samplePost[field]
				note(actual === type ? 'ok' : 'bad', `${field}: ${actual}${actual === type ? '' : ` （应为 ${type}）`}`)
			}
			// 可选字段只报实际情况
			for (const f of ['summary', 'modifiedAt', 'tags', 'images', 'category', 'pinAt', 'pinOrder', 'meta', 'contentFormat', 'text']) {
				const v = samplePost[f]
				console.log(dim(`    ${f}: ${v === undefined ? '不存在' : JSON.stringify(v)?.slice(0, 70)}`))
			}
			// category 是对象且带 name/slug
			const cat = samplePost.category
			note(cat?.name && cat?.slug ? 'ok' : 'warn', `category 带 name/slug: ${cat ? `${cat.name} / ${cat.slug}` : '无'}`)
			// 图片元数据
			const img = samplePost.images?.[0]
			if (img) {
				const rich = ['width', 'height', 'accent', 'thumbhash'].filter(k => img[k] != null)
				note('info', `images[0] 携带的元数据: ${rich.join(', ') || '只有 src'}`)
			}
		}
	}
}

// ---------- 3. 详情：$meta----------

console.log('\n3. 文章详情的 $meta')
if (samplePost?.category?.slug && samplePost?.slug) {
	const post = await client.post
		.getPost(samplePost.category.slug, samplePost.slug)
		.catch(e => ({ __err: e }))
	if (post.__err) {
		note('bad', `post.getPost 失败: ${post.__err.message}`)
	}
	else {
		note(post.title ? 'ok' : 'bad', `数据平铺在顶层: title=${post.title}`)
		note(typeof post.text === 'string' ? 'ok' : 'warn', `text 存在: ${typeof post.text}（主题只读这个字段）`)
		note('info', `contentFormat: ${post.contentFormat ?? '未返回'}`)

		const meta = post.$meta
		if (!meta) {
			note('warn', '$meta 不存在——可能这篇文章没有任何 meta 数据')
			gaps.push('未观察到 $meta，无法确认各字段出现条件')
		}
		else {
			note('ok', `$meta 存在，键: ${Object.keys(meta).join(', ')}`)
			note(Object.keys(post).includes('$meta') ? 'bad' : 'ok', `$meta 不可枚举: ${!Object.keys(post).includes('$meta')}`)
			for (const f of ['paywall', 'summary', 'tts', 'insights', 'related', 'interaction', 'translation'])
				console.log(dim(`    $meta.${f}: ${meta[f] === undefined ? '不存在' : JSON.stringify(meta[f])?.slice(0, 80)}`))

			const mf = metaFor(post, meta)
			console.log(dim(`    metaFor().interaction: ${JSON.stringify(mf.interaction) ?? '无'}`))
		}

		// enrichments 在 $meta 里，不在文档顶层
		const enrich = meta?.enrichments
		if (enrich && Object.keys(enrich).length) {
			const keys = Object.keys(enrich)
			note('ok', `$meta.enrichments 有 ${keys.length} 条`)
			const broken = keys.filter(k => /[a-z][A-Z]/.test(k))
			note(broken.length ? 'bad' : 'ok', `URL 键未被 camelCase 破坏: ${broken.length === 0}`)
			console.log(dim(`    示例: ${keys[0]} → ${JSON.stringify(enrich[keys[0]])?.slice(0, 120)}`))
		}
		else {
			note('info', `$meta.enrichments: ${enrich ? '空对象（后台异步解析尚未完成）' : '不存在'}`)
			gaps.push('enrichments 为空，链接卡片数据的条目形状仍未确认')
		}

		// $meta.translation 是按 article id 索引的 map（metaFor 靠这个区分）
		if (meta?.translation) {
			const tk = Object.keys(meta.translation)
			const isIdIndexed = tk.some(k => /^\d{5,}$/.test(k))
			note(isIdIndexed ? 'ok' : 'info', `$meta.translation 按 article id 索引: ${isIdIndexed}（键: ${tk.join(', ')}）`)
		}
	}
}
else {
	note('warn', '没有可用文章，跳过')
}

// ---------- 4. 其他只读端点 ----------

console.log('\n4. 其他端点')
{
	const checks = [
		// 没有公开可见的日记时它必然 404（顺带查最新一篇日记），下面按已知情况记
		['aggregate.getAggregateData', () => client.aggregate.getAggregateData()],
		['aggregate.getSiteMetadata', () => client.aggregate.getSiteMetadata()],
		['aggregate.getTimeline', () => client.aggregate.getTimeline()],
		['category.getAllCategories', () => client.category.getAllCategories()],
		['note.getList', () => client.note.getList(1, 1)],
		['say.getAllPaginated', () => client.say.getAllPaginated(1, 1)],
		['link.getAll', () => client.link.getAll()],
		['project.getAll', () => client.project.getAll()],
		['topic.getAll', () => client.topic.getAll()],
		['recently.getList', () => client.recently.getList()],
		['page.getList', () => client.page.getList()],
	]
	for (const [name, fn] of checks) {
		try {
			const res = await fn()
			const shape = Array.isArray(res) ? `数组(${res.length})` : Array.isArray(res?.data) ? `{data:${res.data.length}${res.pagination ? ', pagination' : ''}}` : typeof res === 'object' ? `对象{${Object.keys(res).slice(0, 6).join(',')}}` : typeof res
			note('ok', `${name.padEnd(28)} → ${shape}`)
		}
		catch (e) {
			if (name === 'aggregate.getAggregateData' && e.status === 404) {
				note('info', `${name.padEnd(28)} → 404（没有公开可见的日记，主题会退到 /aggregate/site）`)
				gaps.push('没有公开可见的日记：/aggregate 的完整形状无法验证')
				continue
			}
			note('bad', `${name.padEnd(28)} → ${e.message} ${JSON.stringify(e.body ?? '').slice(0, 80)}`)
		}
	}
}

// ---------- 4b. 需鉴权的端点----------

console.log('\n4b. 匿名访问需鉴权的端点')
{
	const authed = [
		['/aggregate/stat', '站点统计'],
		['/aggregate/desk', '工作台'],
	]
	for (const [path, label] of authed) {
		const { status } = await raw(path)
		note(status === 401 ? 'ok' : 'info', `${path.padEnd(20)} → ${status}${status === 401 ? ` （${label}需登录，已知）` : ''}`)
	}
}

// ---------- 4c. 速率限制----------

console.log('\n4c. 速率限制响应头')
{
	const res = await fetch(`${BASE}/posts?size=1`)
	const limit = res.headers.get('x-ratelimit-limit')
	const reset = res.headers.get('x-ratelimit-reset')
	if (limit)
		note('ok', `x-ratelimit-limit=${limit}, reset=${reset}s`)
	else note('warn', '无速率限制响应头')
}

// ---------- 4d. 语言协商与缓存污染----------

console.log('\n4d. 语言规则')
if (samplePost?.category?.slug && samplePost?.slug) {
	// 用第 2 节取到的那篇：带了 ?lang=zh，浏览器的 Accept-Language 就不该再左右返回的语言
	const U = `${BASE}/posts/${encodeURIComponent(samplePost.category.slug)}/${encodeURIComponent(samplePost.slug)}`
	const bust = Date.now()
	const title = async (url, headers = {}) => {
		const r = await fetch(url, { headers })
		const j = await r.json().catch(() => ({}))
		return j?.data?.title
	}
	const baseline = await title(`${U}?k=a${bust}&lang=zh`, { 'Accept-Language': 'zh-CN' })
	const guarded = await title(`${U}?k=b${bust}&lang=zh`, { 'Accept-Language': 'en-US' })
	note(baseline !== undefined && guarded === baseline ? 'ok' : 'bad', `带 ?lang=zh 时英文浏览器拿到「${guarded}」（应与中文浏览器相同：「${baseline}」）`)

	const hazard = await title(`${U}?k=c${bust}`, { 'Accept-Language': 'en-US' })
	if (hazard === undefined || baseline === undefined)
		gaps.push('有一次没取到标题（限流或出错），看不到不带 lang 时的串语言')
	else if (hazard !== baseline)
		note('info', `隐患仍在：不带 lang 时英文浏览器拿到译文「${hazard}」（所以主题必须带 ?lang=zh）`)
	else
		gaps.push('这篇文章没有英文译文，看不到不带 lang 时的串语言')
}
else {
	note('warn', '没有可用文章，跳过')
	gaps.push('没有文章，语言规则无法验证')
}

// ---------- 4e. 代理信任----------

console.log('\n4e. X-Forwarded-For 是否被当作客户端 IP')
{
	const probe = async (ip) => {
		const r = await fetch(`${BASE}/aggregate/site_info`, { headers: { 'X-Forwarded-For': ip } })
		return Number(r.headers.get('x-ratelimit-remaining'))
	}
	const a1 = await probe('10.250.0.1')
	const a2 = await probe('10.250.0.1')
	const b1 = await probe('10.250.0.2')
	const perIp = a2 === a1 - 1 && b1 > a2
	note(perIp ? 'ok' : 'warn', `限流按 XFF 计数: ${perIp}（同一 XFF 剩余 ${a1}→${a2}，换 XFF 后 ${b1}）`)
	if (perIp)
		note('info', 'core 信任直连方的 XFF：必须藏在恰好一层代理后，SSR 必须转发访客真实 IP')
}

// ---------- 5. 分页上限----------

console.log('\n5. 分页上限（size 最大 100）')
{
	const over = await raw('/posts?page=1&size=101')
	note(over.status === 422 ? 'ok' : 'bad', `size=101 → HTTP ${over.status}${over.status === 422 ? '（符合预期）' : '（应为 422）'}`)
	if (over.status === 400)
		console.log(dim(`    错误信封: ${JSON.stringify(over.body).slice(0, 160)}`))

	const ok100 = await raw('/posts?page=1&size=100')
	note(ok100.status === 200 ? 'ok' : 'bad', `size=100 → HTTP ${ok100.status}`)
}

// ---------- 6. 错误信封----------

console.log('\n6. 错误信封')
{
	const nf = await raw('/posts/__no_such_category__/__no_such_slug__')
	const hasShape = nf.body?.error?.code !== undefined
	note(hasShape ? 'ok' : 'bad', `404 响应形如 { error: { code, message } }: ${hasShape}`)
	if (hasShape)
		note('info', `实际 code: ${nf.body.error.code}（按 code 分支，不要匹配 message）`)
	else console.log(dim(`    实际: ${JSON.stringify(nf.body).slice(0, 160)}`))
}

// ═══════════════════════════════════════════════════

console.log(`\n${'─'.repeat(56)}`)
if (gaps.length) {
	console.log('\n仍未覆盖（需要往实例里补内容才能验证）:')
	gaps.forEach(x => console.log(`  · ${x}`))
}
if (findings.length) {
	console.log(`\n${r(`${findings.length} 处与预期不符`)}:`)
	findings.forEach(x => console.log(`  · ${x}`))
	process.exit(1)
}
console.log(`\n${g('与预期一致')}`)
