import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { containsLink } from '../../app/composables/useHeadingAnchor'

describe('正文标题的锚点：标题里已有链接时不再包一层', () => {
	it('认得出普通 <a>、带 href 的组件（ProseA）和藏在加粗里的链接', () => {
		const ProseA = { name: 'ProseA', props: ['href'], render: () => null }
		expect(containsLink([h('a', { href: 'https://x.test' }, '前往')])).toBe(true)
		expect(containsLink([h(ProseA, { href: 'https://example.test/x' }, () => '示例链接')])).toBe(true)
		expect(containsLink([h('strong', null, [h('em', null, [h('a', { href: '#' }, 'x')])])])).toBe(true)
	})

	it('没有链接的标题照常包锚点', () => {
		expect(containsLink([h('code', null, 'npm i'), '安装'])).toBe(false)
		expect(containsLink(['纯文字'])).toBe(false)
		expect(containsLink(undefined)).toBe(false)
	})
})
