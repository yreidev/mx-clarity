/**
 * 本地用的站点反代：照生产的 nginx 分流，`/api/v3`、`/ws/`、`/render`、`/proxy` 交给 core，其余交给主题。
 * 浏览器直连 core 的请求因此与生产一样发到同源。e2e（test/e2e/harness.ts）与局域网预览用它；生产环境用真正的反向代理。
 *
 *   node scripts/site-proxy.mjs --theme http://127.0.0.1:3000 --core https://blog.example.com --port 3001 [--host 0.0.0.0]
 *
 * 交给主题的请求原样转（Host 不变，与 nginx 的 `proxy_set_header Host $host` 一样）；
 * 交给 core 的请求：Host 换成 core 的，追加 X-Forwarded-For；带着 Origin 的写请求把 Origin 换成 core 自己的（core 按它核对来源）。
 * 只是开发工具：不处理 core 设的 `Secure`、`Domain` cookie，经 http 访问时读者登录用不了
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import process from 'node:process'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

const CORE_PATH = /^\/(?:api\/v3|ws|render|proxy)(?:[/?]|$)/

/** 请求交给谁：core 还是主题 */
export function targetOf(path, { theme, core }) {
	return CORE_PATH.test(path) ? core : theme
}

function forwardedHeaders(req, target, toCore) {
	const headers = { ...req.headers }
	if (toCore) {
		headers.host = target.host
		const ip = req.socket.remoteAddress ?? ''
		headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${ip}` : ip
		headers['x-forwarded-proto'] = 'http'
		if (headers.origin)
			headers.origin = target.origin
	}
	return headers
}

export function startSiteProxy({ theme, core, port = 0, host = '127.0.0.1' }) {
	const targets = { theme: new URL(theme), core: new URL(new URL(core).origin) }
	/** 升级成 WebSocket 的连接脱离了 http 服务器的管理，关闭时要自己断 */
	const tunnels = new Set()
	const server = http.createServer((req, res) => {
		const target = targetOf(req.url ?? '/', targets)
		const toCore = target === targets.core
		const request = (target.protocol === 'https:' ? https : http).request({
			protocol: target.protocol,
			hostname: target.hostname,
			port: target.port,
			method: req.method,
			path: req.url,
			headers: forwardedHeaders(req, target, toCore),
		}, (upstream) => {
			res.writeHead(upstream.statusCode ?? 502, upstream.headers)
			upstream.pipe(res)
		})
		request.on('error', () => {
			if (!res.headersSent)
				res.writeHead(502, { 'content-type': 'text/plain' })
			res.end('bad gateway')
		})
		req.pipe(request)
	})
	server.on('upgrade', (req, socket, head) => {
		const target = targetOf(req.url ?? '/', targets)
		const secure = target.protocol === 'https:'
		const portOf = Number(target.port) || (secure ? 443 : 80)
		const upstream = secure
			? tls.connect({ host: target.hostname, port: portOf, servername: target.hostname })
			: net.connect({ host: target.hostname, port: portOf })
		upstream.once(secure ? 'secureConnect' : 'connect', () => {
			const headers = forwardedHeaders(req, target, target === targets.core)
			const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}`))]
			upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
			if (head?.length)
				upstream.write(head)
			upstream.pipe(socket)
			socket.pipe(upstream)
		})
		const close = () => {
			tunnels.delete(close)
			upstream.destroy()
			socket.destroy()
		}
		tunnels.add(close)
		upstream.on('error', close)
		upstream.on('close', close)
		socket.on('error', close)
		socket.on('close', close)
	})
	return new Promise((resolve) => {
		server.listen(port, host, () => {
			const address = server.address()
			resolve({
				url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`,
				close: () => new Promise((done) => {
					for (const close of [...tunnels])
						close()
					server.closeAllConnections?.()
					server.close(() => done())
				}),
			})
		})
	})
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map(part => part.trim().split(/\s+/)))
	if (!args.theme || !args.core) {
		process.stderr.write('用法：node scripts/site-proxy.mjs --theme http://127.0.0.1:3000 --core https://blog.example.com --port 3001 [--host 0.0.0.0]\n')
		process.exit(1)
	}
	const { url } = await startSiteProxy({ theme: args.theme, core: args.core, port: Number(args.port) || 3001, host: args.host || '127.0.0.1' })
	process.stdout.write(`站点反代：${url} → 主题 ${args.theme}，core ${args.core}\n`)
}
