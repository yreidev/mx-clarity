/**
 * 起构建好的主题（`node .output/server/index.mjs`，要先 `pnpm build`），前面套一层照生产 nginx 分流的反代
 * （scripts/site-proxy.mjs：`/api/v3`、`/ws/` 交给 core，其余交给主题），浏览器直连 core 的请求因此与生产一样发到同源；
 * 以及找系统里的 Chrome。
 */
import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import { startSiteProxy } from '../../scripts/site-proxy.mjs'

const ENTRY = new URL('../../.output/server/index.mjs', import.meta.url)

export interface ThemeServer {
	/** 站点地址（反代）：页面与浏览器里的请求都从这里走 */
	url: string
	/** 主题进程自己的地址（绕过反代） */
	themeUrl: string
	/** 主题进程的标准输出与错误输出（结构化日志在这里） */
	logs: string[]
	close: () => Promise<void>
}

export async function freePort() {
	const server = createServer()
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	const { port } = server.address() as AddressInfo
	await new Promise(resolve => server.close(resolve))
	return port
}

export async function startTheme(apiUrl: string, env: Record<string, string> = {}): Promise<ThemeServer> {
	if (!existsSync(ENTRY))
		throw new Error('没有构建产物：先跑 pnpm build')
	const port = await freePort()
	const url = `http://127.0.0.1:${port}`
	const child: ChildProcess = spawn(process.execPath, [ENTRY.pathname], {
		// 整页缓存默认关着：别的测试会改假 core 的返回再看页面；page-cache.e2e.ts 自己打开
		env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), NUXT_MX_API_URL: apiUrl, TZ: 'UTC', NUXT_PAGE_CACHE: '0', ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	const logs: string[] = []
	const collect = (chunk: Buffer) => logs.push(...chunk.toString().split('\n').filter(Boolean))
	child.stdout?.on('data', collect)
	child.stderr?.on('data', collect)
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`主题启动失败：\n${logs.join('\n')}`)
		if (await fetch(`${url}/favicon.svg`).then(res => res.ok, () => false))
			break
		await new Promise(resolve => setTimeout(resolve, 200))
	}
	const site = await startSiteProxy({ theme: url, core: apiUrl })
	return {
		url: site.url,
		themeUrl: url,
		logs,
		close: async () => {
			await site.close()
			await new Promise<void>((resolve) => {
				if (child.exitCode !== null)
					return resolve()
				child.once('exit', () => resolve())
				child.kill()
			})
		},
	}
}

const CHROME_CANDIDATES = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']

/** 系统里的 Chrome：`CHROME_PATH` 优先。CI 设了 `E2E_REQUIRE_BROWSER` 时找不到就报错，本地找不到就跳过浏览器测试 */
export function chromePath() {
	const found = [process.env.CHROME_PATH, ...CHROME_CANDIDATES].find(path => path && existsSync(path))
	if (!found && process.env.E2E_REQUIRE_BROWSER)
		throw new Error('找不到 Chrome：设 CHROME_PATH')
	return found
}
