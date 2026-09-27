/**
 * @dxup/nuxt 生成的 `#build/dxup/layouts.mjs` 没带类型；包本身不导出 runtime，只能从这里引。
 * 错误页用它把插槽登记给布局的具名插槽（pages 下的页面由 dxup 自动包这一层）
 */
declare module '#build/dxup/layouts.mjs' {
	import type { DefineSetupFnComponent } from 'vue'

	export const LayoutSlotsForward: DefineSetupFnComponent<Record<string, any>>
}
