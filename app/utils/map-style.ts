import type { TransformStyleFunction } from 'maplibre-gl'

const COMPARISONS = new Set(['<', '<=', '>', '>='])

/** `[比较, ["get", 属性], …]` → 先判断有这个属性再比；其余原样，子表达式照样处理 */
function guardMissing(expression: unknown): unknown {
	if (!Array.isArray(expression))
		return expression
	const [op, left] = expression
	if (typeof op === 'string' && COMPARISONS.has(op) && Array.isArray(left) && left.length === 2 && left[0] === 'get' && typeof left[1] === 'string')
		return ['all', ['has', left[1]], expression]
	return expression.map(guardMissing)
}

/**
 * 底图样式载入前改一下图层的过滤条件：OpenFreeMap positron 的公路编号牌图层按 `ref_length <= 6` 过滤，
 * 没有编号的路没有这个属性，maplibre 每块瓦片都警告一遍「要数字、拿到 null」再当 false。
 * 先判断属性在不在，结果与原来一样（没有就不画），控制台不再刷屏
 */
export const guardMissingProperties: TransformStyleFunction = (_previous, next) => ({
	...next,
	layers: next.layers.map(layer => ('filter' in layer && layer.filter ? { ...layer, filter: guardMissing(layer.filter) as typeof layer.filter } : layer)),
})
