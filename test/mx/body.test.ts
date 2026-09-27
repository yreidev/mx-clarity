import type { MDCNode, MDCRoot } from '@nuxtjs/mdc'
import { describe, expect, it } from 'vitest'
import { isSafeUrl, preprocessMarkdown, renderMarkdownBody, sanitizeBody } from '../../app/utils/mx/body'
import { fixture } from './helpers'

function walk(node: MDCNode | MDCRoot, visit: (node: MDCNode) => void) {
	for (const child of ('children' in node ? node.children ?? [] : []) as MDCNode[]) {
		visit(child)
		walk(child, visit)
	}
}

function tagsOf(body: MDCRoot) {
	const tags: string[] = []
	walk(body, node => node.type === 'element' && tags.push(node.tag))
	return tags
}

function propsOf(body: MDCRoot) {
	const props: Array<[string, unknown]> = []
	walk(body, node => node.type === 'element' && props.push(...Object.entries(node.props ?? {})))
	return props
}

describe('预处理', () => {
	it('去掉 `::: name` 的空格', () => {
		expect(preprocessMarkdown('::: details{summary="x"}\n内容\n:::')).toBe(':::details{summary="x"}\n内容\n:::')
	})

	it('正文一级标题降为二级，二级及以下不动', () => {
		expect(preprocessMarkdown('# 一\n## 二\n#不是标题')).toBe('## 一\n## 二\n#不是标题')
	})

	it('跳过代码围栏内部，包括更长的围栏和 ~~~', () => {
		const text = ['```md', '# 注释', '::: x', '```', '~~~~', '# 仍在围栏里', '```', '~~~~', '# 标题'].join('\n')
		expect(preprocessMarkdown(text).split('\n')).toEqual(['```md', '# 注释', '::: x', '```', '~~~~', '# 仍在围栏里', '```', '~~~~', '## 标题'])
	})
})

describe('路径 B 的安全过滤', () => {
	it('isSafeUrl：相对地址、http(s)、mailto 放行，其余协议拒绝', () => {
		for (const ok of ['/a', '#h', './x', 'https://a.test', 'mailto:a@b.test', 'x.png'])
			expect(isSafeUrl(ok), ok).toBe(true)
		for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,1', 'vbscript:x'])
			expect(isSafeUrl(bad), bad).toBe(false)
	})

	it('夹具里的 xss-probe：没有 script / iframe，没有事件属性和危险链接', async () => {
		const post = fixture('post-xss-probe').data
		const { body } = await renderMarkdownBody(post.text)
		const tags = tagsOf(body)
		for (const tag of ['script', 'iframe', 'style', 'object', 'embed', 'form'])
			expect(tags).not.toContain(tag)
		for (const [key, value] of propsOf(body)) {
			expect(key).not.toMatch(/^on/i)
			if (typeof value === 'string')
				expect(value).not.toMatch(/^\s*(?:javascript|data|vbscript):/i)
		}
	})

	it('不依赖 mdc 自带的那层：直接喂未经处理的 AST 也能洗干净', () => {
		const body = sanitizeBody({
			type: 'root',
			children: [
				{ type: 'element', tag: 'h1', props: { id: 'x' }, children: [{ type: 'text', value: '标题' }] },
				{ type: 'element', tag: 'img', props: { src: 'javascript:alert(1)', onError: 'alert(2)', alt: 'a' }, children: [] },
				{ type: 'element', tag: 'a', props: { href: 'vbscript:x', title: 't' }, children: [{ type: 'text', value: 'x' }] },
				{ type: 'element', tag: 'p', props: {}, children: [{ type: 'element', tag: 'script', props: {}, children: [{ type: 'text', value: 'alert(3)' }] }] },
				{ type: 'comment', value: 'haklex:poll' },
			],
		} as MDCRoot)
		// 地址不安全的图片整个删掉；链接去掉 href 后只留文字（ProseA 要求 href 必填）
		expect(tagsOf(body)).toEqual(['h2', 'p'])
		expect(Object.fromEntries(propsOf(body))).toEqual({ id: 'x' })
		expect(body.children.map(n => n.type === 'text' ? (n as { value: string }).value : '')).toContain('x')
	})

	it('构造的载荷逐一被挡住', async () => {
		const { body } = await renderMarkdownBody([
			'<script>alert(1)</script>',
			'<iframe src="https://evil.test"></iframe>',
			'<img src="x" onerror="alert(2)">',
			'[点我](javascript:alert(3))',
			'<a href="data:text/html,<script>alert(4)</script>">x</a>',
			'<form action="https://evil.test"><input name="p"></form>',
		].join('\n\n'))
		const tags = tagsOf(body)
		expect(tags).not.toContain('script')
		expect(tags).not.toContain('iframe')
		expect(tags).not.toContain('form')
		expect(tags).not.toContain('input')
		expect(JSON.stringify(body)).not.toMatch(/javascript:|data:text|onerror/i)
	})
})

describe('路径 B：绑定语法与组件属性', () => {
	it('删掉 v-bind、事件、Vue 指令与绑定：mdc 会把 v-bind 的对象摊成属性', async () => {
		const { body } = await renderMarkdownBody([
			`<span v-bind='{"onclick":"alert(1)"}'>a</span>`,
			`<img src="https://img.example/x.png" v-bind='{"src":"x","onerror":"alert(2)"}'>`,
			`**b**{v-bind='{"onmouseover":"alert(3)"}'}`,
			// 反射型：把网址参数整个摊成属性
			`<span v-bind="$route.query">q</span>`,
			`<em :title="$route.query.t" @click="x" #default="y" v-on:click="z">e</em>`,
			// Lexical 的公式拼成 $…$ 走这里，公式里的 $ 能跳出来
			`$x$ <img src="https://img.example/y.png" v-bind='{"onerror":"alert(4)"}'> $y$`,
		].join('\n\n'))
		const props = propsOf(body)
		expect(props.filter(([key]) => /^(?:on|v-|[:@#])/i.test(key))).toEqual([])
		expect(props.filter(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value))).toEqual([])
		// 不是合法 HTML 的（`:title=` 之类）只会留成文字，属性里不许有载荷
		expect(JSON.stringify(props)).not.toMatch(/alert\(|\$route/)
		// 正常的图片与文字还在
		expect(tagsOf(body).filter(tag => tag === 'img')).toHaveLength(2)
	})

	it('video-embed：平台与 id 不合格的整个删掉，合格的只留认得的属性', async () => {
		const { body } = await renderMarkdownBody([
			'::video-embed{type="x" id="javascript:alert(1)"}\n::',
			'::video-embed{type="raw" id="javascript:alert(2)"}\n::',
			'::video-embed{type="youtube" id="abc\\"onload=\\"x"}\n::',
			// 不写 type 就是 raw：协议相对的外站地址不是站内路径，不收
			'::video-embed{id="//evil.example/frame"}\n::',
			'::video-embed{id="https://cdn.example/clip.mp4"}\n::',
			'::video-embed{type="bilibili" id="BV1xx411c7mD" zoom="1" autoplay="true" ratio="16 / 9"}\n::',
			'<video src="/objects/clip.mp4" poster="javascript:alert(3)"></video>',
		].join('\n\n'))
		const embeds: MDCNode[] = []
		walk(body, node => node.type === 'element' && node.tag === 'video-embed' && embeds.push(node))
		expect(embeds.map(node => (node as { props?: unknown }).props)).toEqual([
			// raw 渲染成 <video>，http(s) 的视频地址照收
			{ type: 'raw', id: 'https://cdn.example/clip.mp4' },
			{ type: 'bilibili', id: 'BV1xx411c7mD', ratio: '16 / 9' },
			{ type: 'raw', id: '/objects/clip.mp4' },
		])
		expect(JSON.stringify(body)).not.toMatch(/javascript:|evil\.example/)
	})

	it('提及链接的可访问名称带上平台', async () => {
		const { body } = await renderMarkdownBody('见 {GH@octocat} 与 {TG@example}')
		const links: MDCNode[] = []
		walk(body, node => node.type === 'element' && node.tag === 'a' && links.push(node))
		expect(links.map(node => (node as { props?: Record<string, unknown> }).props?.['aria-label'])).toEqual(['GitHub 用户 octocat', 'Telegram 用户 example'])
	})

	it('带昵称的提及与账号带点的提及合成一个链接（mdc 会把它们拆开）', async () => {
		const { body } = await renderMarkdownBody('见 [示例]{GH@octocat}、{TG@some.one} 与 [两个 词]{TG@some.one}，完')
		const links: MDCNode[] = []
		walk(body, node => node.type === 'element' && node.tag === 'a' && links.push(node))
		expect(links.map(node => [(node as { props?: Record<string, unknown> }).props?.href, (node as { props?: Record<string, unknown> }).props?.['aria-label'], JSON.stringify((node as { children?: unknown }).children)])).toEqual([
			['https://github.com/octocat', '示例（GitHub 用户 octocat）', JSON.stringify([{ type: 'text', value: '示例' }])],
			['https://t.me/some.one', 'Telegram 用户 some.one', JSON.stringify([{ type: 'text', value: '@some.one' }])],
			['https://t.me/some.one', '两个 词（Telegram 用户 some.one）', JSON.stringify([{ type: 'text', value: '两个 词' }])],
		])
		const text = JSON.stringify(body)
		expect(text).not.toContain('mailto:')
		expect(text).not.toMatch(/"value":"[{}]/)
		expect(text).toContain('，完')
	})

	it('每一段的行内扩展都照常展开（不只第一段）', async () => {
		const { body } = await renderMarkdownBody('第一段 ==甲==\n\n第二段 ==乙== 与 ||剧透||\n\n- 列表 ^上^')
		const tags = tagsOf(body)
		expect(tags.filter(tag => tag === 'mark')).toHaveLength(2)
		expect(tags).toContain('blur')
		expect(tags).toContain('sup')
	})

	it('链接里的内容照常规整：不认的组件换成占位', async () => {
		const { body } = await renderMarkdownBody('[:badge{link="javascript:alert(3)"}](https://ok.example) 和 [~user/a^b](https://ok.example/~user/)')
		expect(tagsOf(body)).not.toContain('badge')
		expect(JSON.stringify(body)).toContain('mx-unsupported')
		expect(JSON.stringify(body)).not.toContain('javascript:')
		// 链接文字不做行内扩展：~user/ 与 a^b 原样
		expect(JSON.stringify(body)).toContain('~user/a^b')
	})
})

describe('目录', () => {
	it('mx-syntax-sample 产出目录，且没有一级标题', async () => {
		const post = fixture('post-syntax-sample').data
		const { body, toc } = await renderMarkdownBody(post.text)
		expect(tagsOf(body)).not.toContain('h1')
		expect(toc?.links.length).toBeGreaterThan(0)
		expect(toc?.links.every(link => link.depth >= 2)).toBe(true)
	})

	it('一级标题降级后进目录，id 与标题元素一致', async () => {
		const { body, toc } = await renderMarkdownBody('# 标题一\n\n正文\n\n## 小节')
		expect(toc?.links.map(l => l.text)).toEqual(['标题一', '小节'])
		const ids: string[] = []
		walk(body, node => node.type === 'element' && /^h[2-4]$/.test(node.tag) && ids.push(String(node.props?.id)))
		expect(ids).toEqual(toc?.links.map(l => l.id))
	})

	it('lexical 文章的投影能解析：代码块与标题都在', async () => {
		const post = fixture('post-lexical-lists').data
		const { body, toc } = await renderMarkdownBody(post.text)
		expect(tagsOf(body).filter(t => t === 'pre')).toHaveLength(3)
		expect(toc?.links.map(l => l.text)).toEqual(['开始之前', '每个命令做了什么', '注意事项'])
		// h3 挂在前一个 h2 下面
		expect(toc?.links[1]?.children?.map(l => l.text)).toEqual(['Windows 上的写法'])
	})
})
