import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { themeConfigFrom } from '../../app/utils/mx/theme'
import { contentSecurityPolicyOf, createNonce, cspModeOf, minimalPolicyOf, withNonce } from '../../server/utils/csp'

function directives(policy: string) {
	return Object.fromEntries(policy.split('; ').map((part) => {
		const [name, ...values] = part.split(' ')
		return [name, values]
	}))
}

describe('给脚本加 nonce', () => {
	it('只动 <script> 与 modulepreload；已有 nonce 的不重复加；<scripts>、别的 link 不误伤', () => {
		const html = [
			'<script>window.__NUXT__={}</script>',
			'<script type="module" src="/_nuxt/entry.js" crossorigin></script>',
			'<script nonce="old">keep()</script>',
			'<script\nid="x">multi()</script>',
			'<link rel="modulepreload" as="script" crossorigin href="/_nuxt/a.js">',
			'<link rel="stylesheet" href="/_nuxt/a.css">',
			'<scripts>不是脚本</scripts>',
		].join('')
		const out = withNonce(html, 'N0nce==')
		expect(out.match(/nonce="N0nce=="/g)).toHaveLength(4)
		expect(out).toContain('<script nonce="old">keep()</script>')
		expect(out).toContain('<link rel="stylesheet" href="/_nuxt/a.css">')
		expect(out).toContain('<scripts>不是脚本</scripts>')
		expect(out).toContain('<link nonce="N0nce==" rel="modulepreload"')
	})

	it('nonce 每次都不同，16 字节', () => {
		const a = createNonce()
		expect(a).not.toBe(createNonce())
		expect(Buffer.from(a, 'base64')).toHaveLength(16)
	})
})

describe('策略', () => {
	it('脚本只认本次的 nonce；站长脚本的域名与声明的 connect 进 connect-src；Host 校验后写 wss', () => {
		const policy = directives(contentSecurityPolicyOf({
			nonce: 'abc',
			host: 'blog.example.com',
			scripts: [
				{ src: 'https://www.googletagmanager.com/gtag/js?id=G-X', connect: ['https://*.google-analytics.com'] },
				{ src: 'http://insecure.example/x.js' },
			],
			frameAncestors: ['https://admin.example.com'],
		}))
		expect(policy['script-src']).toEqual(expect.arrayContaining(['\'nonce-abc\'', '\'strict-dynamic\'', '\'wasm-unsafe-eval\'']))
		expect(policy['script-src']).not.toContain('\'unsafe-eval\'')
		expect(policy['connect-src']).toEqual(['\'self\'', 'https://tiles.openfreemap.org', 'wss://blog.example.com', 'https://www.googletagmanager.com', 'https://*.google-analytics.com'])
		expect(policy['frame-ancestors']).toEqual(['\'self\'', 'https://admin.example.com'])
		expect(policy['object-src']).toEqual(['\'none\''])
		expect(policy['base-uri']).toEqual(['\'self\''])
		expect(policy['frame-src']).toContain('https://player.bilibili.com')
		// YouTube 只放隐私增强模式的域名
		expect(policy['frame-src']).toContain('https://www.youtube-nocookie.com')
		expect(policy['frame-src']).not.toContain('https://www.youtube.com')
	})

	it('host 不合格式的不写进策略（防止借 Host 头往策略里塞指令）', () => {
		for (const host of ['evil.example; script-src *', 'a b', ''])
			expect(directives(contentSecurityPolicyOf({ nonce: 'n', host, scripts: [], frameAncestors: [] }))['connect-src']).toEqual(['\'self\'', 'https://tiles.openfreemap.org'])
	})

	it('开关只认三个值，其余按生效；最小策略带着防嵌套', () => {
		expect(cspModeOf('report-only')).toBe('report-only')
		expect(cspModeOf('off')).toBe('off')
		expect(cspModeOf('')).toBe('enforce')
		expect(cspModeOf('nope')).toBe('enforce')
		expect(minimalPolicyOf([])).toBe(`frame-ancestors 'self'; object-src 'none'; base-uri 'self'`)
	})
})

describe('主题配置里脚本的 connect', () => {
	it('只收 https 的域名（可以 *. 通配），最多 5 个；不合格的丢掉', () => {
		const { config } = themeConfigFrom({ scripts: [
			{ src: 'https://a.example/s.js', connect: ['https://*.b.example', 'https://c.example:8443', 'http://d.example', 'https://e.example; script-src \'unsafe-eval\'', 'https://f.example/path', 7] },
			{ src: 'https://g.example/s.js', connect: ['https://1.example', 'https://2.example', 'https://3.example', 'https://4.example', 'https://5.example', 'https://6.example'] },
			{ src: 'https://h.example/s.js' },
		] })
		expect(config.scripts.map(s => s.connect)).toEqual([
			['https://*.b.example', 'https://c.example:8443'],
			['https://1.example', 'https://2.example', 'https://3.example', 'https://4.example', 'https://5.example'],
			undefined,
		])
	})
})
