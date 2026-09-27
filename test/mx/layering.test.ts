/**
 * 取数的分层规则做成测试：mx 的数据只经 app/utils/mx 取与映射，页面拿到的都是主题自己的类型；
 * 浏览器直连 core 只经 useCore.ts 这一处。
 * eslint 里有同样的规则；这里再查一遍，
 * 免得规则被 eslint 配置的改动悄悄关掉。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCANNED = ['app', 'server', 'modules', 'shared']
const EXT = /\.(?:[cm]?[jt]s|vue)$/

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		return entry.isDirectory() ? walk(path) : EXT.test(entry.name) ? [path] : []
	})
}

const files = SCANNED.flatMap(dir => walk(join(ROOT, dir))).map(path => ({
	path: relative(ROOT, path).replaceAll('\\', '/'),
	source: readFileSync(path, 'utf8'),
}))

describe('取数的分层规则', () => {
	it('扫到了文件（防止路径写错导致空跑）', () => {
		expect(files.length).toBeGreaterThan(50)
	})

	it('只有 app/utils/mx/** 能 import api-client', () => {
		const importsClient = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"]@mx-space\/api-client(?:\/[^'"]*)?['"]/
		const allowed = (path: string) => path.startsWith('app/utils/mx/')
		const violations = files.filter(f => importsClient.test(f.source) && !allowed(f.path)).map(f => f.path)
		expect(violations).toEqual([])
	})

	it('浏览器直连 core 只经一处：页面、组件、布局、composable、插件都不自己建 client，浏览器的 client 只由 useCore.ts 建', () => {
		const ui = /^app\/(?:pages|components|layouts|composables|plugins)\//
		const violations = files.filter(f => ui.test(f.path) && /\bcreateMxClient\s*\(/.test(f.source)).map(f => f.path)
		expect(violations).toEqual([])
		const builders = files.filter(f => /\bbrowserMxClient\s*\(/.test(f.source) && f.path !== 'app/utils/mx/browser.ts').map(f => f.path)
		expect(builders).toEqual(['app/composables/useCore.ts'])
	})

	it('不读详情里的 `$meta.interaction`：core 按访客 IP 算 isLiked，却按网址缓存 15 秒，会把别人的「已赞」给你（「我赞过没有」由浏览器自己记）', () => {
		const readsInteraction = /(?:\?\.|\.)interaction\b|\[\s*['"]interaction['"]\s*\]|[{,]\s*interaction\s*[,:}]|\bis_liked\b/
		const violations = files.filter(f => readsInteraction.test(f.source)).map(f => f.path)
		expect(violations).toEqual([])
	})
})
