/**
 * 地图底图样式载入前的修补：按数字比较的属性先判断在不在
 */
import { describe, expect, it } from 'vitest'
import { guardMissingProperties } from '../../app/utils/map-style'

type Style = Parameters<typeof guardMissingProperties>[1]

const style = (layers: unknown[]) => ({ version: 8, sources: {}, layers }) as unknown as Style

describe('底图样式', () => {
	it('按数字比较的属性先判断在不在，嵌在 all 里的也改；别的条件与没有过滤条件的图层原样', () => {
		const shield = ['all', ['<=', ['get', 'ref_length'], 6], ['match', ['get', 'network'], ['us-interstate'], true, false]]
		const out = guardMissingProperties(undefined, style([
			{ id: 'shield', type: 'symbol', filter: shield },
			{ id: 'water', type: 'fill', filter: ['==', ['get', 'class'], 'ocean'] },
			{ id: 'legacy', type: 'line', filter: ['<=', 'admin_level', 4] },
			{ id: 'background', type: 'background' },
		]))
		expect(out.layers.map(layer => 'filter' in layer ? layer.filter : undefined)).toEqual([
			['all', ['all', ['has', 'ref_length'], ['<=', ['get', 'ref_length'], 6]], ['match', ['get', 'network'], ['us-interstate'], true, false]],
			['==', ['get', 'class'], 'ocean'],
			['<=', 'admin_level', 4],
			undefined,
		])
	})
})
