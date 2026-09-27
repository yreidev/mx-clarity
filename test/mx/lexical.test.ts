import type { MDCElement, MDCNode, MDCRoot } from '@nuxtjs/mdc'
import { describe, expect, it } from 'vitest'
import { renderMarkdownBody } from '../../app/utils/mx/body'
import { parseLexicalState, renderLexicalBody } from '../../app/utils/mx/lexical'
import { renderPostBody } from '../../app/utils/mx/render'
import { fixture } from './helpers'

// —— 小工具 ——

function walk(node: MDCNode | MDCRoot, visit: (node: MDCElement) => void) {
	for (const child of ('children' in node ? node.children ?? [] : []) as MDCNode[]) {
		if (child.type === 'element')
			visit(child as MDCElement)
		walk(child, visit)
	}
}
function elements(body: MDCRoot, tag: string) {
	const out: MDCElement[] = []
	walk(body, n => n.tag === tag && out.push(n))
	return out
}
const textOf = (node: MDCNode): string => node.type === 'text' ? (node as { value: string }).value : ((node as MDCElement).children ?? []).map(textOf).join('')
function shape(node: MDCNode): unknown {
	return node.type === 'text'
		? (node as { value: string }).value
		: [(node as MDCElement).tag, ...((node as MDCElement).children ?? []).map(shape)]
}

const t = (text: string, format = 0) => ({ type: 'text', text, format })
const p = (...children: object[]) => ({ type: 'paragraph', children })
const state = (...children: object[]) => ({ root: { type: 'root', children } })
const render = (...children: object[]) => renderLexicalBody(state(...children))

describe('路径 A 的节点映射', () => {
	it('文本格式按位嵌套，行内代码与 mdc 同形', async () => {
		const { body } = await render(p(t('粗', 1), t('斜', 2), t('删', 4), t('码', 16), t('粗斜', 3)))
		expect(body.children.map(shape)).toEqual([['p', ['strong', '粗'], ['em', '斜'], ['del', '删'], ['code', '码'], ['strong', ['em', '粗斜']]]])
		expect(elements(body, 'code')[0]!.props).toMatchObject({ code: '码' })
	})

	it('正文一级标题降为二级，id 与 mdc 同规则', async () => {
		const { body, toc } = await render({ type: 'heading', tag: 'h1', children: [t('标题 A')] }, { type: 'heading', tag: 'h2', children: [t('1 开头')] })
		expect(body.children.map(n => (n as MDCElement).tag)).toEqual(['h2', 'h2'])
		expect(toc?.links.map(l => l.id)).toEqual(['标题-a', '_1-开头'])
	})

	it('链接过协议白名单，危险链接只留文字', async () => {
		const { body } = await render(p({ type: 'link', url: 'https://a.test', children: [t('好')] }, { type: 'link', url: 'javascript:alert(1)', children: [t('坏')] }))
		expect(body.children.map(shape)).toEqual([['p', ['a', '好'], '坏']])
		expect(elements(body, 'a')[0]!.props).toMatchObject({ href: 'https://a.test', rel: ['nofollow'] })
	})

	it('段落里的块级节点（图片）把段落拆开，避免 <p> 里套块级元素', async () => {
		const { body } = await render(p(t('前'), { type: 'image', src: 'https://i.test/a.png', altText: 'a', caption: '图注' }, t('后')))
		expect(body.children.map(n => (n as MDCElement).tag)).toEqual(['p', 'pic', 'p'])
		expect((body.children[1] as MDCElement).props).toMatchObject({ src: 'https://i.test/a.png', alt: 'a', caption: '图注' })
	})

	it('alert-quote / banner 的正文在 content.root 里，要下钻', async () => {
		const inner = { root: { children: [p(t('提示内容'))] } }
		const { body } = await render({ type: 'alert-quote', alertType: 'warning', content: inner }, { type: 'banner', bannerType: 'tip', content: inner })
		expect(body.children.map(shape)).toEqual([['alert', ['p', '提示内容']], ['alert', ['p', '提示内容']]])
		expect(body.children.map(n => (n as MDCElement).props?.type)).toEqual(['warning', 'tip'])
	})

	it('details → Folding，grid-container → CardList（cells 是编辑器状态）', async () => {
		const { body } = await render(
			{ type: 'details', summary: '点开', children: [p(t('折叠'))] },
			{ type: 'grid-container', cols: 2, cells: [{ root: { children: [p(t('一'))] } }, { root: { children: [p(t('二'))] } }] },
		)
		expect(body.children.map(shape)).toEqual([['folding', ['p', '折叠']], ['card-list', ['ul', ['li', ['p', '一']], ['li', ['p', '二']]]]])
		expect((body.children[0] as MDCElement).props).toMatchObject({ title: '点开' })
	})

	it('chat 按 Chat.vue 的 {名字} / {.名字} 约定生成', async () => {
		const { body } = await render({
			type: 'chat',
			variant: 'user-agent',
			participants: [{ id: 'u', name: '我', kind: 'user' }, { id: 'a', name: '助手', kind: 'agent' }],
			messages: [{ participantId: 'u', content: '你好' }, { participantId: 'a', content: '在的' }],
		})
		expect(body.children.map(shape)).toEqual([['chat', ['p', '{.我}'], ['p', '你好'], ['p', '{助手}'], ['p', '在的']]])
	})

	it('行内扩展：spoiler、mention、ruby、footnote', async () => {
		const { body } = await render(p(
			{ type: 'spoiler', children: [t('秘密')] },
			{ type: 'mention', platform: 'GH', handle: 'innei' },
			{ type: 'mention', platform: 'GH', handle: 'bad/../x' },
			{ type: 'ruby', reading: 'かんじ', children: [t('漢字')] },
			{ type: 'footnote', identifier: '1' },
		))
		expect(body.children.map(shape)).toEqual([['p', ['blur', '秘密'], ['a', '@innei'], '@bad/../x', ['ruby', '漢字', ['rt', 'かんじ']], ['sup', ['a', '[1]']]]])
		expect(elements(body, 'a')[0]!.props?.href).toBe('https://github.com/innei')
	})

	it('带昵称的提及：两条路径输出同一个链接', async () => {
		const a = await render(p({ type: 'mention', platform: 'GH', handle: 'octocat', displayName: '示例' }))
		const b = await renderMarkdownBody('[示例]{GH@octocat}')
		expect(elements(a.body, 'a')).toEqual(elements(b.body, 'a'))
		expect(elements(a.body, 'a')).toHaveLength(1)
	})

	it('提及链接的可访问名称带上平台；显示的是昵称时昵称在前', async () => {
		const { body } = await render(p(
			{ type: 'mention', platform: 'GH', handle: 'octocat' },
			{ type: 'mention', platform: 'tw', handle: 'example', displayName: '示例' },
		))
		expect(elements(body, 'a').map(a => a.props?.['aria-label'])).toEqual(['GitHub 用户 octocat', '示例（X 用户 example）'])
	})

	it('任务列表保留只读复选框', async () => {
		const { body } = await render({ type: 'list', listType: 'check', children: [{ type: 'listitem', checked: true, children: [t('完成')] }] })
		const box = elements(body, 'input')[0]!
		expect(box.props).toEqual({ type: 'checkbox', disabled: true, checked: true })
	})

	it('公式交给路径 B 的解析器，输出与路径 B 逐字一致', async () => {
		const a = await render(p(t('质能 '), { type: 'katex-inline', equation: 'E=mc^2' }), { type: 'katex-block', equation: '\\sum_i i' })
		const b = await renderMarkdownBody('质能 $E=mc^2$\n\n$$\n\\sum_i i\n$$')
		expect(a.body).toEqual(b.body)
	})

	it('未知节点给占位，绝不把原始 JSON 打到页面上', async () => {
		const { body } = await render({ type: 'future-node', secret: '<script>alert(1)</script>' }, { type: 'excalidraw', snapshot: '{"a":1}' })
		expect(elements(body, 'p').every(n => (n.props?.className as string[]).includes('mx-unsupported'))).toBe(true)
		expect(JSON.stringify(body)).not.toContain('secret')
		expect(JSON.stringify(body)).not.toContain('script')
	})

	it('构造出的危险 URL 一律被挡住', async () => {
		const { body } = await render(
			{ type: 'image', src: 'javascript:alert(1)' },
			{ type: 'video', src: 'data:video/mp4,xx' },
			{ type: 'link-card', url: 'vbscript:x' },
			p({ type: 'autolink', url: ' javascript:alert(2)', children: [t('x')] }),
		)
		expect(JSON.stringify(body)).not.toMatch(/javascript:|data:|vbscript:/i)
		expect(elements(body, 'pic')).toHaveLength(0)
		expect(elements(body, 'video-embed')).toHaveLength(0)
		expect(elements(body, 'link-card')).toHaveLength(0)
	})

	it('content 解析失败时退到路径 B', async () => {
		expect(parseLexicalState('{broken')).toBeUndefined()
		expect(parseLexicalState(JSON.stringify({ root: {} }))).toBeUndefined()
		const result = await renderPostBody({ contentFormat: 'lexical', content: '{broken', text: '## 兜底' })
		expect(result.source).toBe('markdown')
		expect(result.toc?.links[0]?.text).toBe('兜底')
	})
})

describe('路径 B 的容器映射到同一批组件', () => {
	const tagsOf = async (md: string) => (await renderMarkdownBody(md)).body.children.map(shape)

	it('提示框（GFM alert）、details、横幅容器、grid', async () => {
		expect(await tagsOf('> [!WARNING]\n> 小心')).toEqual([['alert', ['p', '小心']]])
		expect(await tagsOf('::: details{summary="点开"}\n折叠\n:::')).toEqual([['folding', ['p', '折叠']]])
		expect(await tagsOf('::: tip\n横幅\n:::')).toEqual([['alert', ['p', '横幅']]])
		expect(await tagsOf('::: grid{cols=2}\n::: cell\n一\n:::\n::: cell\n二\n:::\n:::')).toEqual([['card-list', ['ul', ['li', ['p', '一']], ['li', ['p', '二']]]]])
	})

	it('||剧透|| 与 {GH@x}；代码里的不动', async () => {
		expect(await tagsOf('看 ||秘密|| 和 {GH@innei}')).toEqual([['p', '看 ', ['blur', '秘密'], ' 和 ', ['a', '@innei']]])
		expect(await tagsOf('`a || b`')).toEqual([['p', ['code', 'a || b']]])
	})

	it('公式里的 || 不当成剧透', async () => {
		const { body } = await renderMarkdownBody('$||x||$')
		expect(elements(body, 'blur')).toHaveLength(0)
	})

	it('任务列表的复选框保留为只读', async () => {
		const { body } = await renderMarkdownBody('- [x] 完成\n- [ ] 未完成')
		expect(elements(body, 'input').map(n => n.props)).toEqual([
			{ type: 'checkbox', disabled: true, checked: true },
			{ type: 'checkbox', disabled: true, checked: false },
		])
	})
})

describe('同一篇 Lexical 文章，两条路径的结构一致', () => {
	const posts = ['post-lexical-lists', 'post-lexical-steps', 'post-lexical-media']

	for (const name of posts) {
		it(name, async () => {
			const post = fixture(name).data
			const a = await renderLexicalBody(parseLexicalState(post.content)!)
			const b = await renderMarkdownBody(post.text)
			const summary = (body: MDCRoot) => ({
				code: elements(body, 'pre').map(n => [n.props?.language, n.props?.code]),
				links: elements(body, 'a').map(n => n.props?.href).filter(href => !String(href).startsWith('#')),
				cells: elements(body, 'td').concat(elements(body, 'th')).map(n => textOf(n).trim()),
			})
			// 目录：id、层级、文字完全一致
			expect(a.toc).toEqual(b.toc)
			expect(summary(a.body)).toEqual(summary(b.body))
			// 图片：路径 A 是带图注的 Pic，路径 B 是普通 img，地址一致
			expect(elements(a.body, 'pic').map(n => n.props?.src)).toEqual(elements(b.body, 'img').map(n => n.props?.src))
		})
	}
})

describe('路径 B 的未知标签与失效链接', () => {
	it('未知标签（LiteXML 的 <node>、废止的组件）给占位；<video> 走 VideoEmbed', async () => {
		const { body } = await renderMarkdownBody('<node type="map" data=\'{"a":1}\'></node>\n\n::tab\n内容\n::\n\n<video src="https://v.test/a.mp4" controls></video>')
		const tags = body.children.map(n => (n as MDCElement).tag)
		expect(tags).toEqual(['p', 'p', 'video-embed'])
		expect(elements(body, 'p').every(n => (n.props?.className as string[])?.includes('mx-unsupported'))).toBe(true)
		expect((body.children[2] as MDCElement).props).toMatchObject({ type: 'raw', id: 'https://v.test/a.mp4' })
	})

	it('去掉危险 href 的链接展开成文字，不留没有 href 的 <a>', async () => {
		const { body } = await renderMarkdownBody('[点我](javascript:alert(1)) 与 <a href="vbscript:x">这个</a>')
		expect(elements(body, 'a')).toHaveLength(0)
		expect(textOf(body.children[0]!)).toContain('点我')
	})
})

describe('路径 B 的行内格式与路径 A 对齐', () => {
	it('==高亮==、++插入++、^上标^、~下标~，删除线仍是 ~~x~~', async () => {
		const md = await renderMarkdownBody('==亮== ++插++ x^2^ H~2~O ~~删~~')
		const lexical = await renderLexicalBody({ root: { type: 'root', children: [{ type: 'paragraph', children: [
			{ type: 'text', text: '亮', format: 128 },
			{ type: 'text', text: ' ', format: 0 },
			{ type: 'text', text: '插', format: 8 },
			{ type: 'text', text: ' x', format: 0 },
			{ type: 'text', text: '2', format: 64 },
			{ type: 'text', text: ' H', format: 0 },
			{ type: 'text', text: '2', format: 32 },
			{ type: 'text', text: 'O ', format: 0 },
			{ type: 'text', text: '删', format: 4 },
		] }] } })
		expect(md.body.children.map(shape)).toEqual([['p', ['mark', '亮'], ' ', ['u', '插'], ' x', ['sup', '2'], ' H', ['sub', '2'], 'O ', ['del', '删']]])
		expect(lexical.body.children.map(shape)).toEqual(md.body.children.map(shape))
	})

	it('链接里的 ~ 与 ^ 不当成下标、上标', async () => {
		const { body } = await renderMarkdownBody('<https://a.test/~user/x~y>')
		expect(elements(body, 'sub')).toHaveLength(0)
		expect(textOf(body.children[0]!)).toBe('https://a.test/~user/x~y')
	})
})
