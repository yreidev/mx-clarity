/**
 * 富内容：Skill、markdown 里 core 投影的块、GitHub 文件与 Gist、地图的视角与停留点、K 线的成交量、CSP
 */
import { describe, expect, it } from 'vitest'
import { renderMarkdownBody } from '../../app/utils/mx/body'
import { githubTargetOf, languageOfPath, mapPropsOf, mapTrackOf, sliceLines } from '../../app/utils/mx/rich-blocks'
import { parseSkillMarkdown, rewriteSkillLinks, skillAssetPathOf, skillNameOfRawUrl } from '../../app/utils/mx/skills'
import { stockBarsFrom } from '../../app/utils/mx/stocks'
import { contentSecurityPolicyOf } from '../../server/utils/csp'

describe('文章附带的 Skill', () => {
	it('从 rawUrl 认出名称；附件路径每段都要像文件名', () => {
		expect(skillNameOfRawUrl('https://blog.example.test/api/v3/s/sk/demo-skill/SKILL.md')).toBe('demo-skill')
		expect(skillNameOfRawUrl('https://blog.example.test/api/v3/s/sk/demo-skill/SKILL.md?ts=1')).toBe('demo-skill')
		expect(skillNameOfRawUrl('https://blog.example.test/api/v3/s/sk/../SKILL.md')).toBeUndefined()
		expect(skillNameOfRawUrl('https://evil.test/other')).toBeUndefined()
		expect(skillAssetPathOf(['docs', 'a.md'])).toBe('docs/a.md')
		expect(skillAssetPathOf('img/a.png')).toBe('img/a.png')
		for (const bad of [['..', 'x'], ['.'], ['a?b'], ['a#b'], ['a\\b'], [], [''], ['x'.repeat(101)], Array.from({ length: 9 }).fill('a')])
			expect(skillAssetPathOf(bad), JSON.stringify(bad)).toBeUndefined()
	})

	it('开头的 --- 只取 name、description，去掉正文第一个标题', () => {
		const parsed = parseSkillMarkdown('\uFEFF---\nname: "写作助手"\ndescription: 帮你改稿：先读再改\nallowed-tools: x\n---\n# 写作助手\n\n正文')
		expect(parsed).toEqual({ name: '写作助手', description: '帮你改稿：先读再改', body: '\n正文' })
		expect(parseSkillMarkdown('没有头\n\n# 不是第一行的标题')).toEqual({ body: '没有头\n\n# 不是第一行的标题' })
	})

	it('相对链接与图片改写到本站的附件转发；站外、站内绝对路径、锚点不动', async () => {
		const { body } = await renderMarkdownBody('[说明](docs/guide.md#usage) [外站](https://example.test/) [站内](/about) [锚点](#top) [穿越](../x.md) ![图](./img/a.png)')
		const raw = JSON.stringify(rewriteSkillLinks(body, 'demo'))
		expect(raw).toContain('"href":"/skills/demo/docs/guide.md#usage"')
		expect(raw).toContain('"src":"/skills/demo/img/a.png"')
		expect(raw).toContain('"href":"https://example.test/"')
		expect(raw).toContain('"href":"/about"')
		expect(raw).toContain('"href":"#top"')
		expect(raw).not.toContain('/skills/demo/..')
	})
})

describe('markdown 里 core 投影的块', () => {
	it('<node type="stock|map" data> 转成与 Lexical 同样的块；后面的内容不丢', async () => {
		const stock = JSON.stringify({ variant: 'snapshot', symbol: 'aapl' }).replaceAll('"', '&quot;')
		const map = JSON.stringify({ title: '东京', pois: [{ lat: 35.6, lon: 139.7 }] }).replaceAll('"', '&quot;')
		const { body } = await renderMarkdownBody(`前\n\n<node type="stock" id="a" data="${stock}" />\n\n中\n\n<node type="map" data="${map}" />\n\n后`)
		const raw = JSON.stringify(body)
		expect(raw).toContain('"tag":"stock-block"')
		expect(raw).toContain('"symbol":"AAPL"')
		expect(raw).toContain('"tag":"map-block"')
		for (const text of ['前', '中', '后'])
			expect(raw).toContain(`"value":"${text}"`)
		expect(raw.indexOf('stock-block')).toBeLessThan(raw.indexOf('"value":"中"'))
		expect(raw.indexOf('"value":"中"')).toBeLessThan(raw.indexOf('map-block'))
	})

	it('认不出的、data 坏的给占位，后面的内容照样在', async () => {
		const { body } = await renderMarkdownBody('<node type="dynamic" data="{}" />\n\n后面\n\n<node type="stock" data="not json" />\n\n再后面')
		const raw = JSON.stringify(body)
		expect(raw.match(/此内容暂不支持显示/g)).toHaveLength(2)
		expect(raw).toContain('"value":"后面"')
		expect(raw).toContain('"value":"再后面"')
	})
})

describe('嵌入 GitHub 文件与 Gist', () => {
	it('认文件地址（带行号）与 Gist；别的主机、路径穿越、非 https 不认', () => {
		expect(githubTargetOf('https://github.com/mx-space/core/blob/main/apps/core/src/main.ts#L10-L20')).toEqual({ kind: 'file', url: 'https://github.com/mx-space/core/blob/main/apps/core/src/main.ts#L10-L20', owner: 'mx-space', repo: 'core', ref: 'main', path: 'apps/core/src/main.ts', start: 10, end: 20 })
		expect(githubTargetOf('https://github.com/a/b/blob/v1/README.md#L5')).toMatchObject({ start: 5, end: 5 })
		expect(githubTargetOf('https://github.com/a/b/blob/v1/README.md#L9-L3')).toMatchObject({ start: 9, end: 9 })
		expect(githubTargetOf('https://github.com/a/b/blob/v1/README.md')).not.toHaveProperty('start')
		expect(githubTargetOf('https://gist.github.com/someone/0123456789abcdef')).toEqual({ kind: 'gist', url: 'https://gist.github.com/someone/0123456789abcdef', id: '0123456789abcdef' })
		for (const bad of ['http://github.com/a/b/blob/main/x.ts', 'https://github.com/a/b/tree/main/x', 'https://github.com/a/b/blob/main/../x', 'https://evil.test/a/b/blob/main/x', 'https://github.com/a/b', 'https://user@github.com/a/b/blob/main/x', 'https://github.com:8443/a/b/blob/main/x', 'https://gist.github.com/someone/not-hex'])
			expect(githubTargetOf(bad), bad).toBeUndefined()
	})

	it('按行截取：有范围取那几行，没有取开头，最多 200 行', () => {
		const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n')
		expect(sliceLines(text, 10, 12)).toEqual({ code: 'line 10\nline 11\nline 12', from: 10, to: 12, total: 300 })
		const head = sliceLines(text)
		expect([head.from, head.to]).toEqual([1, 200])
		expect(head.code.split('\n')).toHaveLength(200)
		expect(sliceLines(text, 250, 999)).toMatchObject({ from: 250, to: 300 })
		expect(sliceLines('a\r\nb\n', 1, 99)).toEqual({ code: 'a\nb', from: 1, to: 2, total: 2 })
		expect(sliceLines('a\nb', 50)).toMatchObject({ from: 2, to: 2, code: 'b' })
		expect([languageOfPath('src/main.ts'), languageOfPath('x/Dockerfile'), languageOfPath('x.unknown'), languageOfPath('Makefile')]).toEqual(['ts', 'docker', 'text', 'text'])
	})
})

describe('地图与股票', () => {
	it('视角只收合法的中心与缩放', () => {
		expect(mapPropsOf({ pois: [{ lat: 1, lon: 2 }], view: { center: [139.7, 35.6], zoom: 12 } })?.view).toBe('{"center":[139.7,35.6],"zoom":12}')
		expect(mapPropsOf({ pois: [{ lat: 1, lon: 2 }], view: { center: [999, 35], zoom: 12 } })).not.toHaveProperty('view')
		expect(mapPropsOf({ pois: [{ lat: 1, lon: 2 }], view: { center: [139.7, 35.6], zoom: 30 } })).not.toHaveProperty('view')
	})

	it('停留点只要停留 ≥ 10 分钟、坐标合法的，最多 100 个', () => {
		const track = mapTrackOf({
			points: [[35, 139], [35.1, 139.1]],
			stops: [
				{ lat: 35, lon: 139, durationSec: 1200.4, visits: 2, time: '2026-09-01T00:00:00Z' },
				{ lat: 35, lon: 139, durationSec: 60 },
				{ lat: 99, lon: 0, durationSec: 999 },
				{ lat: 35, lon: 139, durationSec: 700, visits: 1.5, time: 'not a date' },
			],
		})
		expect(track?.stops).toEqual([{ lat: 35, lon: 139, duration: 1200, visits: 2, time: '2026-09-01T00:00:00.000Z' }, { lat: 35, lon: 139, duration: 700 }])
		const many = mapTrackOf({ points: [[1, 1], [2, 2]], stops: Array.from({ length: 150 }, () => ({ lat: 1, lon: 1, durationSec: 600 })) })
		expect(many?.stops).toHaveLength(100)
	})

	it('股票 K 线的每一根带上成交量（没有的记 0）', () => {
		const bars = stockBarsFrom({ meta: {}, bars: [{ open: 1, high: 2, low: 0.5, close: 1.5, timestamp: 1, volume: 100 }, { open: 1.5, high: 2, low: 1, close: 1.8, timestamp: 2 }] })
		expect(bars?.bars.map(bar => bar.volume)).toEqual([100, 0])
	})

	it('内容安全策略放行地图瓦片的主机与本站、blob 的 worker', () => {
		const policy = contentSecurityPolicyOf({ nonce: 'n', scripts: [], frameAncestors: [] })
		expect(policy).toMatch(/connect-src [^;]*https:\/\/tiles\.openfreemap\.org/)
		expect(policy).toContain('worker-src \'self\' blob:')
	})
})
