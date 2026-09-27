import type { FeedEntry, FeedSite } from '../../app/utils/mx/feed'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { renderMarkdownBody } from '../../app/utils/mx/body'
import { buildAtomFeed, escapeXml, FEED_LIMIT } from '../../app/utils/mx/feed'
import { feedHtmlOf } from '../../app/utils/mx/feed-html'
import packageJson from '../../package.json'

const site: FeedSite = {
	title: '示例博客',
	description: '站点描述',
	url: 'https://blog.example.test/',
	author: { name: '作者', avatar: 'https://a.example.test/avatar.png' },
	icon: 'https://a.example.test/icon.png',
	language: 'zh-CN',
}

function entry(over: Partial<FeedEntry> = {}): FeedEntry {
	return {
		title: '标题',
		path: '/posts/tech/slug',
		summary: '摘要',
		image: 'https://img.example.test/cover.png',
		category: '技术',
		published: '2026-09-01T00:00:00.000Z',
		...over,
	}
}

/** 系统里有 xmllint 时顺便查一下 XML 是否合法 */
function wellFormed(xml: string) {
	try {
		execFileSync('xmllint', ['--noout', '-'], { input: xml, stdio: ['pipe', 'ignore', 'pipe'] })
		return true
	}
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return true
		throw error
	}
}

describe('自己生成的 Atom', () => {
	it('站名、地址来自传入的站点配置，条目地址是绝对地址', () => {
		const xml = buildAtomFeed(site, [entry()])
		expect(xml).toContain('<title>示例博客</title>')
		expect(xml).toContain('<link href="https://blog.example.test/atom.xml" rel="self" />')
		expect(xml).toContain('<id>https://blog.example.test/posts/tech/slug</id>')
		expect(xml).toContain('<?xml-stylesheet type="text/xsl" href="/assets/atom.xsl"?>')
		// 生成器是本主题，地址与版本取 package.json
		expect(xml).toContain(`<generator uri="${packageJson.homepage}" version="${packageJson.version}">mx-clarity</generator>`)
		expect(wellFormed(xml)).toBe(true)
	})

	it('新的在前，最多 20 条；日期不对的丢掉；更新时间取最新一条', () => {
		const many = Array.from({ length: 25 }, (_, i) => entry({ title: `第${i}`, path: `/p/${i}`, published: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }))
		const xml = buildAtomFeed(site, [...many, entry({ title: '坏日期', published: 'not a date' })])
		const titles = [...xml.matchAll(/<entry><id>[^<]*<\/id><title>([^<]*)<\/title>/g)].map(m => m[1])
		expect(titles).toHaveLength(FEED_LIMIT)
		expect(titles[0]).toBe('第24')
		expect(titles).not.toContain('坏日期')
		expect(xml).toContain('<updated>2026-01-25T00:00:00.000Z</updated>')
	})

	it('标题、摘要里的 HTML 被转义；content 里拼出来的 HTML 只有我们自己的标签', () => {
		const xml = buildAtomFeed(site, [entry({
			title: '<script>alert(1)</script>',
			summary: '<img src=x onerror=alert(2)> & "引号"',
			image: 'javascript:alert(3)',
			category: '"><x',
		})])
		expect(xml).not.toContain('<script>')
		expect(xml).not.toContain('javascript:')
		expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
		// content 解开一层后才是 HTML：危险片段仍然只是文字
		const content = xml.match(/<content type="html">([^<]*)<\/content>/)![1]!
		const html = content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
		expect(html).not.toContain('<img')
		expect(html).toContain('<p>&lt;img src=x onerror=alert(2)&gt; &amp; &quot;引号&quot;</p>')
		expect(html).toContain('<a class="view-full" href="https://blog.example.test/posts/tech/slug" rel="noopener">点击查看全文</a>')
		expect(wellFormed(xml)).toBe(true)
	})

	it('封面只收 http(s)；XML 不允许的控制字符去掉', () => {
		const xml = buildAtomFeed(site, [entry({ title: `a${String.fromCharCode(0)}b${String.fromCharCode(27)}c` })])
		expect(xml).toContain('<title>abc</title>')
		expect(xml).toContain('&lt;img src=&quot;https://img.example.test/cover.png&quot;')
		expect(escapeXml('\'"<>&')).toBe('&apos;&quot;&lt;&gt;&amp;')
	})

	it('站点地址不是 http(s) 时退回占位地址，不输出 javascript:', () => {
		const xml = buildAtomFeed({ ...site, url: 'javascript:alert(1)' }, [entry()])
		expect(xml).not.toContain('javascript:')
		expect(xml).toContain('<id>http://localhost/posts/tech/slug</id>')
	})
})

describe('订阅源里的全文（feed-html）', () => {
	const ctx = { base: 'https://blog.example.test/', link: 'https://blog.example.test/posts/tech/slug' }
	const htmlOf = async (markdown: string, max?: number) => feedHtmlOf((await renderMarkdownBody(markdown)).body, ctx, max)

	it('排版标签照留，相对地址转成绝对地址，站内锚点接在条目地址后面', async () => {
		const html = await htmlOf('## 小标题\n\n**粗** [站内](/about) [锚点](#part) [外站](https://x.example/a)\n\n![图](/img/a.png)\n\n- 一\n- 二')
		expect(html).toContain('<h2>小标题</h2>')
		expect(html).toContain('<strong>粗</strong>')
		expect(html).toContain('<a href="https://blog.example.test/about" rel="noopener noreferrer nofollow">站内</a>')
		expect(html).toContain('href="https://blog.example.test/posts/tech/slug#part"')
		expect(html).toContain('src="https://blog.example.test/img/a.png"')
		expect(html).toContain('<ul>')
	})

	it('危险的一概不出：脚本、事件属性、javascript: 链接、http 图片、iframe、style、class', async () => {
		const html = await htmlOf('<script>alert(1)</script>\n\n<iframe src="https://evil.example"></iframe>\n\n<p style="color:red" class="x" onclick="alert(2)">段落</p>\n\n[点我](javascript:alert(3)) ![外图](http://evil.example/a.png)\n\n<svg><circle /></svg>')
		for (const bad of ['<script', 'alert(1)', '<iframe', 'evil.example', 'style=', 'onclick', 'class="x"', 'javascript:', '<svg', '<circle'])
			expect(html, bad).not.toContain(bad)
		expect(html).toContain('段落')
	})

	it('公式换成 TeX 源码，代码块只留语言类名', async () => {
		const html = await htmlOf('行内 $a^2$\n\n$$\nE=mc^2\n$$\n\n```ts\nconst a = 1 < 2\n```')
		expect(html).toContain('<code>a^2</code>')
		expect(html).toContain('<pre><code>E=mc^2</code></pre>')
		expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2')
		expect(html).not.toContain('katex')
	})

	it('主题组件降级：剧透不出内容、提示框成引用、折叠成 details', async () => {
		const html = await htmlOf('这里有||秘密内容||\n\n::alert{type="warning"}\n小心\n::\n\n::folding{title="展开看"}\n里面\n::')
		expect(html).not.toContain('秘密内容')
		expect(html).toContain('〔剧透内容，请到原文查看〕')
		expect(html).toContain('<blockquote><p><strong>注意</strong></p>')
		expect(html).toContain('<details><summary>展开看</summary>')
	})

	it('超长时截到上一个完整的块，说明未完', async () => {
		const html = await htmlOf(Array.from({ length: 50 }, (_, i) => `第 ${i} 段${'字'.repeat(50)}`).join('\n\n'), 1000)
		expect(html.length).toBeLessThan(1300)
		expect(html).toContain('未完')
		expect(html.match(/<p>/g)!.length).toBeGreaterThan(3)
	})

	it('条目：有全文放全文；付费文章只放摘要并说明', () => {
		const withHtml = buildAtomFeed(site, [entry({ html: '<p>全文</p>' })])
		expect(withHtml).toContain('&lt;p&gt;全文&lt;/p&gt;')
		expect(withHtml).toContain('在网站上阅读')
		const premium = buildAtomFeed(site, [entry({ html: '<p>不该出现的全文</p>', premium: true })])
		expect(premium).not.toContain('不该出现的全文')
		expect(premium).toContain('本文为付费文章')
		expect(wellFormed(withHtml) && wellFormed(premium)).toBe(true)
	})
})
