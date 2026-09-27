import { createFetch } from 'ofetch'
import { describe, expect, it } from 'vitest'
import { defaultThemeConfig, footerCopyrightOf, loadThemeConfig, mergeThemeOverlay, redirectTargetOf, themeConfigFrom } from '../../app/utils/mx/theme'

/** 让 ofetch 真实地请求一个假响应：错误就是运行时会遇到的 FetchError */
describe('主题配置：解析与净化', () => {
	it('没有配置时全是默认值，没有警告', () => {
		expect(themeConfigFrom(undefined)).toEqual({ config: defaultThemeConfig(), warnings: [] })
		expect(themeConfigFrom(null)).toEqual({ config: defaultThemeConfig(), warnings: [] })
	})

	it('合法的配置逐项生效，没写的项保持默认', () => {
		const { config, warnings } = themeConfigFrom({
			subtitle: '写点东西',
			header: { logo: 'https://img.example.com/me.png', showTitle: false, emojiTail: ['🌙'], titleFont: { family: 'Alimama FangYuanTi', url: '/fonts/title.woff2' } },
			footer: {
				copyright: '© {year} {author}，保留所有权利',
				iconNav: [{ icon: 'tabler:brand-github', text: 'GitHub', url: 'https://github.com/someone' }],
				nav: [{ title: '信息', items: [{ icon: 'tabler:certificate', text: '某ICP备1号', url: 'https://beian.miit.gov.cn/' }] }],
			},
			since: '2020-05-01',
			birthYear: 1999,
			blogLog: [{ label: '2020-05-01', value: '博客上线' }],
			categories: [{ name: '技术', icon: 'tabler:code', color: '#3a7bd5', type: 'tech' }, { name: '随笔', type: 'story' }],
			redirects: [{ from: '/2021/hello-world/', to: '/posts/tech/hello-world' }],
			scripts: [{ src: 'https://stats.example.com/s.js', defer: true }],
		})
		expect(warnings).toEqual([])
		expect(config.subtitle).toBe('写点东西')
		expect(config.header).toEqual({ logo: 'https://img.example.com/me.png', showTitle: false, emojiTail: ['🌙'], titleFont: { family: 'Alimama FangYuanTi', url: '/fonts/title.woff2' } })
		expect(config.footer.iconNav).toHaveLength(1)
		expect(config.footer.nav[0]!.items[0]!.text).toBe('某ICP备1号')
		expect(config.since).toBe('2020-05-01')
		expect(config.birthYear).toBe(1999)
		expect(config.categories).toEqual([{ name: '技术', icon: 'tabler:code', color: '#3a7bd5', type: 'tech' }, { name: '随笔', type: 'story' }])
		// 末尾的斜杠去掉，匹配时与请求路径一样规范化
		expect(config.redirects).toEqual([{ from: '/2021/hello-world', to: '/posts/tech/hello-world' }])
		expect(config.scripts).toEqual([{ src: 'https://stats.example.com/s.js', defer: true }])
		expect(config.license).toEqual(defaultThemeConfig().license)
	})

	it('危险的链接与资源一律丢掉：javascript:、协议相对地址、data:、非 https 的脚本、能跳出 CSS 字符串的字体地址', () => {
		const { config, warnings } = themeConfigFrom({
			header: { logo: 'data:image/svg+xml,<svg onload=alert(1)>', titleFont: { family: 'X', url: 'https://f.example.com/a.woff2");}body{display:none' } },
			footer: {
				iconNav: [
					{ icon: 'tabler:x', text: '坏链接', url: 'javascript:alert(1)' },
					{ icon: 'tabler:x', text: '协议相对', url: '//evil.example.com' },
					{ icon: 'not an icon', text: '坏图标', url: '/ok' },
					{ icon: 'tabler:mail', text: '邮箱', url: 'mailto:me@example.com' },
				],
			},
			scripts: [{ src: 'http://stats.example.com/s.js' }, { src: 'javascript:alert(1)' }],
			redirects: [{ from: '/a', to: 'javascript:alert(1)' }],
		})
		expect(config.header.logo).toBe('')
		expect(config.header.titleFont).toBeNull()
		expect(config.footer.iconNav).toEqual([{ icon: 'tabler:mail', text: '邮箱', url: 'mailto:me@example.com' }])
		expect(config.scripts).toEqual([])
		expect(config.redirects).toEqual([])
		expect(warnings.length).toBeGreaterThanOrEqual(5)
	})

	it('类型不对的项退回默认值并给出警告，其余照常', () => {
		const { config, warnings } = themeConfigFrom({ footer: '页脚', birthYear: '1999', since: '2020/01/01', subtitle: '正常', categories: [{ name: '技术', type: 'essay' }] })
		expect(config.footer).toEqual(defaultThemeConfig().footer)
		expect(config.birthYear).toBe(0)
		expect(config.since).toBe('')
		expect(config.subtitle).toBe('正常')
		// 版式只认 blog.config.ts 里有的（tech / story）
		expect(config.categories).toEqual([])
		expect(warnings).toEqual(expect.arrayContaining([
			'footer 格式不对，已用默认值',
			'birthYear 格式不对，已用默认值',
			'since 格式不对，已用默认值',
		]))
		expect(themeConfigFrom('不是对象').warnings).toEqual(['主题配置应是一个 JSON 对象，已全部用默认值'])
	})

	it('评论的「浏览器 · 系统」默认开，可以关；类型不对退回默认并警告', () => {
		expect(defaultThemeConfig().comments.showAgent).toBe(true)
		expect(themeConfigFrom({ comments: { showAgent: false } }).config.comments.showAgent).toBe(false)
		const { config, warnings } = themeConfigFrom({ comments: { showAgent: 'no' } })
		expect(config.comments.showAgent).toBe(true)
		expect(warnings).toContain('comments.showAgent 格式不对，已用默认值')
	})

	it('侧栏导航：默认 8 项；站长可以换成自己的，格式不对的项丢掉并警告', () => {
		expect(defaultThemeConfig().nav.map(item => item.url)).toEqual(['/', '/notes', '/says', '/thinking', '/projects', '/link', '/archive', '/timeline'])
		const { config, warnings } = themeConfigFrom({ nav: [
			{ icon: 'tabler:files', text: '文章', url: '/' },
			{ icon: 'tabler:archive', text: '归档', url: '/archive' },
			{ text: '坏的', url: 'javascript:alert(1)' },
		] })
		expect(config.nav.map(item => item.url)).toEqual(['/', '/archive'])
		expect(warnings.some(w => w.startsWith('nav'))).toBe(true)
		expect(themeConfigFrom({ nav: '不是数组' }).config.nav).toHaveLength(8)
	})

	it('站点时区：认得的 IANA 名照收，空串表示没填，认不得的退回默认并警告', () => {
		expect(defaultThemeConfig().timeZone).toBe('')
		expect(themeConfigFrom({ timeZone: 'America/New_York' }).config.timeZone).toBe('America/New_York')
		expect(themeConfigFrom({ timeZone: '' }).config.timeZone).toBe('')
		for (const bad of ['Mars/Olympus', 'Asia/Shanghai; x', 8, null]) {
			const { config, warnings } = themeConfigFrom({ timeZone: bad })
			expect(config.timeZone).toBe('')
			expect(warnings).toContain('timeZone 格式不对，已用默认值')
		}
	})

	it('跳转不能盖住首页、Nuxt 的资源与接口', () => {
		const { config } = themeConfigFrom({
			redirects: ['/', '/_nuxt/app.js', '/api/mx/site', '/__nuxt_error'].map(from => ({ from, to: '/x' })).concat({ from: '/old', to: '/new' }),
		})
		expect(config.redirects).toEqual([{ from: '/old', to: '/new' }])
	})

	it('按请求路径找跳转目标：末尾斜杠、中文路径的编码与否都能对上', () => {
		const redirects = themeConfigFrom({ redirects: [{ from: '/2021/旧文章', to: '/posts/tech/new' }, { from: '/about/', to: 'https://me.example.com' }] }).config.redirects
		expect(redirectTargetOf(redirects, '/2021/%E6%97%A7%E6%96%87%E7%AB%A0')).toBe('/posts/tech/new')
		expect(redirectTargetOf(redirects, '/2021/旧文章/')).toBe('/posts/tech/new')
		expect(redirectTargetOf(redirects, '/about')).toBe('https://me.example.com')
		expect(redirectTargetOf(redirects, '/2021')).toBeUndefined()
		expect(redirectTargetOf(redirects, '/%E0%A4%A')).toBeUndefined()
	})

	it('页脚版权文字的占位符', () => {
		expect(footerCopyrightOf('© {year} {author}', '博主', 2026)).toBe('© 2026 博主')
	})
})

describe('主题配置：读取', () => {
	/** 片段接口：按名字给状态码与内容；记下问过哪些 */
	function snippets(table: Record<string, [number, unknown]>) {
		const asked: string[] = []
		const fetch = createFetch({
			fetch: async (input) => {
				const name = new URL(String(input)).pathname.replace('/api/v3/s/theme/', '')
				asked.push(name)
				const [status, body] = table[name] ?? [404, { error: { code: 'SNIPPET_NOT_FOUND', message: 'Snippet not found' } }]
				return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
			},
		})
		return { asked, snippet: (name: string) => fetch(`http://core.test/api/v3/s/theme/${name}`) }
	}
	const noAggregate = () => Promise.reject(Object.assign(new Error('404'), { status: 404 }))
	const PRIVATE: [number, unknown] = [403, { error: { code: 'SNIPPET_PRIVATE', message: 'Snippet is private' } }]

	it('先走聚合接口：拿到就用，不再问片段接口', async () => {
		const { asked, snippet } = snippets({})
		const { config } = await loadThemeConfig({ aggregate: async () => ({ subtitle: '你好' }), snippet }, 'zh')
		expect(config.subtitle).toBe('你好')
		expect(asked).toEqual([])
	})

	it('聚合接口说没有：默认值；只问一次自己的片段，认出「私有」给提示', async () => {
		const missing = snippets({})
		expect(await loadThemeConfig({ aggregate: async () => undefined, snippet: missing.snippet })).toEqual({ config: defaultThemeConfig(), warnings: [] })
		expect(missing.asked).toEqual(['mx-clarity'])
		const hidden = snippets({ 'mx-clarity': PRIVATE })
		const { config, warnings } = await loadThemeConfig({ aggregate: async () => undefined, snippet: hidden.snippet })
		expect(config).toEqual(defaultThemeConfig())
		expect(warnings[0]).toContain('私有')
	})

	it('聚合接口失败（没有可见日记时 404）：按顺序读片段，取第一个有的，再合语言覆盖', async () => {
		const { asked, snippet } = snippets({
			'yohaku': [200, { subtitle: '基础', nav: [{ icon: 'tabler:home', text: '首页', url: '/' }, { icon: 'tabler:archive', text: '归档', url: '/archive' }] }],
			'yohaku.zh': [200, { nav: [{ text: '主页' }] }],
			'shiro': [200, { subtitle: '不该用到' }],
		})
		const { config } = await loadThemeConfig({ aggregate: noAggregate, snippet }, 'zh')
		expect(asked).toEqual(['mx-clarity', 'yohaku', 'yohaku.zh'])
		expect(config.subtitle).toBe('基础')
		// 数组按下标合并：覆盖片段只改了第一项的文字
		expect(config.nav.map(item => [item.text, item.url])).toEqual([['主页', '/'], ['归档', '/archive']])
	})

	it('都没有：默认值；私有的给提示；core 出错照抛', async () => {
		expect((await loadThemeConfig({ aggregate: noAggregate, snippet: snippets({}).snippet })).config).toEqual(defaultThemeConfig())
		const { warnings } = await loadThemeConfig({ aggregate: noAggregate, snippet: snippets({ 'mx-clarity': PRIVATE }).snippet })
		expect(warnings[0]).toContain('theme/mx-clarity')
		await expect(loadThemeConfig({ aggregate: noAggregate, snippet: snippets({ 'mx-clarity': [500, { error: { code: 'INTERNAL', message: 'x' } }] }).snippet })).rejects.toThrow()
		await expect(loadThemeConfig({ aggregate: noAggregate, snippet: () => Promise.reject(new TypeError('fetch failed')) })).rejects.toThrow('fetch failed')
	})

	it('yohaku / Shiro 的格式：只认页脚链接、简介、年份与备案号，其余不认，并提示', async () => {
		const official = {
			config: { hero: { description: '一句话简介' }, custom: { js: ['https://evil.example/a.js'], css: ['body{}'] }, site: { favicon: 'https://evil.example/f.ico' } },
			footer: {
				linkSections: [{ name: '关于', links: [{ name: '关于本站', href: '/about' }, { name: '坏链接', href: 'javascript:alert(1)' }] }],
				otherInfo: { date: '2020-{{now}}', icp: { text: '某ICP备1号', link: 'https://beian.miit.gov.cn/' } },
			},
		}
		const { config, warnings } = await loadThemeConfig({ aggregate: async () => official, snippet: snippets({}).snippet })
		expect(config.subtitle).toBe('一句话简介')
		expect(config.footer.copyright).toBe('© 2020-{year} {author}')
		expect(config.footer.nav).toEqual([
			{ title: '关于', items: [{ icon: 'tabler:link', text: '关于本站', url: '/about' }] },
			{ title: '信息', items: [{ icon: 'tabler:certificate', text: '某ICP备1号', url: 'https://beian.miit.gov.cn/' }] },
		])
		expect(config.scripts).toEqual([])
		expect(JSON.stringify(config)).not.toContain('evil.example')
		expect(warnings.join()).toContain('Yohaku')
	})

	it('覆盖片段的合并：对象深合并、数组按下标，不改原对象，挡住 __proto__', () => {
		const base = { a: { b: 1, c: [1, 2, 3] }, d: 'x' }
		const merged = mergeThemeOverlay(base, JSON.parse('{"a":{"c":[9]},"e":2,"__proto__":{"polluted":true}}')) as Record<string, unknown>
		expect(merged).toEqual({ a: { b: 1, c: [9, 2, 3] }, d: 'x', e: 2 })
		expect(base.a.c).toEqual([1, 2, 3])
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})
})
