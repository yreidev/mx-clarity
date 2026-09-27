import { pascalCase } from 'es-toolkit/string'
import {
	LazyWidgetActivity,
	LazyWidgetBlogLog,
	LazyWidgetBlogStats,
	LazyWidgetBlogTech,
	LazyWidgetEmpty,
	LazyWidgetMostRead,
	LazyWidgetNoteAround,
	LazyWidgetSay,
	LazyWidgetToc,
} from '#components'

// @keep-sorted
const rawWidgets = {
	LazyWidgetActivity,
	LazyWidgetBlogLog,
	LazyWidgetBlogStats,
	LazyWidgetBlogTech,
	LazyWidgetEmpty,
	LazyWidgetMostRead,
	LazyWidgetNoteAround,
	LazyWidgetSay,
	LazyWidgetToc,
}

type RawWidgetName = keyof typeof rawWidgets

/** 若首字母大写还需移除`-`前缀 */
type KebabCase<S extends string> = S extends `${infer First}${infer Rest}`
	? `${First extends Capitalize<First> ? '-' : ''}${Lowercase<First>}${KebabCase<Rest>}`
	: ''

type RemovePrefix<S extends string, Prefix extends string> = S extends `${Prefix}${infer Rest}` ? Rest : S

export type WidgetName = RemovePrefix<KebabCase<RawWidgetName>, '-lazy-widget-'>

/**
 * 侧栏挂件。名字来自页面，或 mx 的 `meta.aside`；不认识的名字跳过。
 * 上游的 `meta-aside-*` 插槽挂件依赖 Nuxt Content 的 rehype-meta-slots，随它一起删除
 */
export default function useWidgets(widgetList: MaybeRefOrGetter<WidgetName[]>) {
	const widgets = computed(() => toValue(widgetList).flatMap((widgetName) => {
		const comp = rawWidgets[`LazyWidget${pascalCase(widgetName)}` as RawWidgetName]
		return comp ? [{ name: widgetName, comp }] : []
	}))

	return {
		widgets,
	}
}
