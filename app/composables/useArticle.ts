import type { ArticleDetail } from '~/types/article'
import type { ThemeConfig } from '~/types/theme'

/**
 * 获取已加载的文章内容/元信息。文章、日记、独立页的详情共用 `mxPostKey`；
 * 日记没有 article 字段，只提供目录
 */
export function useArticle(path?: MaybeRefOrGetter<string | undefined>) {
	const route = useRoute()
	const pagePath = computed(() => toValue(path) ?? route.path)
	const detail = computed(() => useNuxtData<Partial<Pick<ArticleDetail, 'article' | 'toc'>> | null | undefined>(mxPostKey(pagePath.value)).data.value)

	return {
		post: computed(() => detail.value?.article),
		toc: computed(() => detail.value?.toc),
	}
}

/** 分类的图标与颜色：主题配置里的在前，blog.config.ts 的默认值兜底。模板里也会调用，所以只读已取好的数据 */
function themeCategoryOf(category?: string) {
	return useNuxtData<ThemeConfig>('mx-theme-config').data.value?.categories.find(c => c.name === category)
}

export function getCategoryIcon(category?: string) {
	const appConfig = useAppConfig()
	return themeCategoryOf(category)?.icon ?? appConfig.article.categories[category!]?.icon ?? 'tabler:folder'
}

export function getCategoryColor(category?: string) {
	const appConfig = useAppConfig()
	return themeCategoryOf(category)?.color ?? appConfig.article.categories[category!]?.color
}

interface GetPostTypeClassNameOptions {
	prefix?: string
}

export function getPostTypeClassName(type = 'tech', options?: GetPostTypeClassNameOptions) {
	const { prefix = 'text' } = options || {}
	return `${prefix}-${type}`
}
