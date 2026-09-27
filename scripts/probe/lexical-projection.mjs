/**
 * Lexical → Markdown 真实投影探针
 *
 *   pnpm probe:lexical
 *
 * 复刻 core 的 mxLexicalToMarkdown（packages/editor/src/core/markdown.ts），
 * 对每种 Lexical 节点跑真实 $toMarkdown() 投影，得出 blog-v3 渲染层的真实输入语法。
 */
import { $toMarkdown, allHeadlessNodes, sanitizeSerializedJSON } from '@haklex/rich-headless'
import { createHeadlessEditor } from '@lexical/headless'

function project(children) {
	const state = JSON.stringify({
		root: { children, direction: 'ltr', format: '', indent: 0, type: 'root', version: 1 },
	})
	const sanitized = sanitizeSerializedJSON(state, {
		nodes: allHeadlessNodes,
		onUnknown: (type) => { throw new Error(`unknown node: ${type}`) },
	})
	const editor = createHeadlessEditor({
		nodes: allHeadlessNodes,
		onError: (e) => {
			throw e
		},
	})
	const parsed = editor.parseEditorState(sanitized)
	editor.setEditorState(parsed)
	let md = ''
	editor.read(() => {
		md = $toMarkdown()
	})
	return md
}

function text(t, format = 0) {
	return {
		detail: 0,
		format,
		mode: 'normal',
		style: '',
		text: t,
		type: 'text',
		version: 1,
	}
}
function para(...kids) {
	return {
		children: kids,
		direction: 'ltr',
		format: '',
		indent: 0,
		type: 'paragraph',
		version: 1,
	}
}

const cases = [
	['heading', [{ children: [text('二级标题')], direction: 'ltr', format: '', indent: 0, tag: 'h2', type: 'heading', version: 1 }]],
	['paragraph + 粗斜体', [para(text('普通 '), text('粗体', 1), text(' '), text('斜体', 2))]],
	['quote', [{ children: [text('引用内容')], direction: 'ltr', format: '', indent: 0, type: 'quote', version: 1 }]],
	['list (bullet)', [{
		children: [
			{ children: [text('第一项')], direction: 'ltr', format: '', indent: 0, type: 'listitem', value: 1, version: 1 },
			{ children: [text('第二项')], direction: 'ltr', format: '', indent: 0, type: 'listitem', value: 2, version: 1 },
		],
		direction: 'ltr',
		format: '',
		indent: 0,
		listType: 'bullet',
		start: 1,
		tag: 'ul',
		type: 'list',
		version: 1,
	}]],
	['horizontalrule', [{ type: 'horizontalrule', version: 1 }]],
	['code-block', [{ code: 'const a = 1', language: 'ts', type: 'code-block', version: 1 }]],
	['image', [{ altText: '图片说明', src: 'https://example.com/a.png', type: 'image', version: 1 }]],
	['image + caption', [{ altText: 'alt文本', caption: '这是图注', src: 'https://example.com/a.png', type: 'image', version: 1 }]],
	['katex-inline', [para(text('公式 '), { equation: 'E=mc^2', type: 'katex-inline', version: 1 })]],
	['katex-block', [{ equation: '\\sum_{i=1}^{n} i', type: 'katex-block', version: 1 }]],
	['mermaid', [{ diagram: 'graph LR\n A --> B', type: 'mermaid', version: 1 }]],
	['spoiler', [para({ children: [text('被遮住')], direction: 'ltr', format: '', indent: 0, type: 'spoiler', version: 1 })]],
	['mention', [para(text('提及 '), { handle: 'L33Z22L11', platform: 'GH', type: 'mention', version: 1 })]],
	['link', [para({ children: [text('链接文字')], direction: 'ltr', format: '', indent: 0, rel: null, target: null, title: null, type: 'link', url: 'https://example.com', version: 1 })]],
	['link-card', [{ type: 'link-card', url: 'https://github.com/mx-space/core', version: 1 }]],
	['alert-quote', [{ children: [para(text('提示内容'))], direction: 'ltr', format: '', indent: 0, alertType: 'note', type: 'alert-quote', version: 1 }]],
	['details（对应 Folding.vue）', [{ children: [para(text('折叠内容'))], direction: 'ltr', format: '', indent: 0, open: false, summary: '点击展开', type: 'details', version: 1 }]],
	['banner（对应 LinkBanner.vue）', [{ children: [para(text('横幅内容'))], direction: 'ltr', format: '', indent: 0, type: 'banner', version: 1 }]],
	['video（对应 VideoEmbed.vue）', [{ src: 'https://example.com/v.mp4', type: 'video', version: 1 }]],
	['embed', [{ type: 'embed', url: 'https://www.youtube.com/watch?v=x', version: 1 }]],
	['grid-container（对应 CardList.vue）', [{ children: [para(text('格子内容'))], direction: 'ltr', format: '', indent: 0, type: 'grid-container', version: 1 }]],
	['poll', [{ type: 'poll', pollId: 'p1', version: 1 }]],
	['footnote', [para(text('正文'), { type: 'footnote', version: 1, footnoteId: '1' })]],
	['tag', [para({ type: 'tag', version: 1, tag: 'nuxt' })]],
	['excalidraw', [{ data: '{}', type: 'excalidraw', version: 1 }]],
	['rich-quote', [{ children: [para(text('富引用'))], direction: 'ltr', format: '', indent: 0, type: 'rich-quote', version: 1 }]],
	['code-snippet', [{ type: 'code-snippet', version: 1, snippetId: 's1' }]],
	['file', [{ type: 'file', version: 1, src: 'https://example.com/a.pdf', name: 'a.pdf' }]],
	['nested-doc', [{ type: 'nested-doc', version: 1, docId: 'd1' }]],
	['dynamic', [{ type: 'dynamic', version: 1, name: 'x' }]],
	['chat（user-user）', [{ type: 'chat', version: 1, variant: 'user-user', participants: [{ id: 'a', name: '甲', kind: 'user' }, { id: 'b', name: '乙', kind: 'user' }], messages: [{ participantId: 'a', content: '你好' }, { participantId: 'b', content: '在的' }] }]],
	['gallery（多图）', [{ type: 'gallery', version: 1, images: [{ src: 'https://e.com/1.png', alt: '图一' }, { src: 'https://e.com/2.png', alt: '图二' }] }]],
	['ruby（正确属性 reading）', [para({ children: [text('漢字')], direction: 'ltr', format: '', indent: 0, type: 'ruby', version: 1, reading: 'かんじ' })]],
	['comment（正确属性 text）', [para({ type: 'comment', version: 1, text: '这是批注内容' })]],
	['table', [{
		children: [{
			children: [
				{ children: [para(text('A'))], direction: 'ltr', format: '', indent: 0, type: 'tablecell', version: 1, headerState: 1, colSpan: 1, rowSpan: 1 },
				{ children: [para(text('B'))], direction: 'ltr', format: '', indent: 0, type: 'tablecell', version: 1, headerState: 1, colSpan: 1, rowSpan: 1 },
			],
			direction: 'ltr',
			format: '',
			indent: 0,
			type: 'tablerow',
			version: 1,
		}],
		direction: 'ltr',
		format: '',
		indent: 0,
		type: 'table',
		version: 1,
	}]],
]

console.log('═'.repeat(64))
console.log('Lexical 节点 → Markdown 真实投影（@haklex/rich-headless 0.42.1）')
console.log('═'.repeat(64))

const ok = []
const failed = []

for (const [name, children] of cases) {
	try {
		const md = project(children)
		ok.push([name, md])
		console.log(`\n■ ${name}`)
		console.log(md === '' ? '  (空输出)' : md.split('\n').map(l => `  ${l}`).join('\n'))
	}
	catch (e) {
		failed.push([name, e.message])
	}
}

if (failed.length) {
	console.log(`\n${'─'.repeat(64)}\n构造失败（属性结构需要进一步确认，不代表节点不可用）:`)
	for (const [name, msg] of failed) console.log(`  · ${name}: ${msg.slice(0, 110)}`)
}
console.log(`\n成功 ${ok.length} / ${cases.length}`)
