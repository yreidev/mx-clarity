import type { ArticleOrderType, ArticleProps } from '~/types/article'
import { orderBy } from 'es-toolkit/array'

interface UseArticleSortOptions {
	bindDirectionQuery?: string
	bindOrderQuery?: string
	initialAscend?: boolean
	initialOrder?: ArticleOrderType
}

export function useArticleSort<T extends Pick<ArticleProps, ArticleOrderType | 'date'>>(list: MaybeRefOrGetter<readonly T[]>, options?: UseArticleSortOptions) {
	const appConfig = useAppConfig()
	const {
		bindDirectionQuery,
		bindOrderQuery,
		initialAscend = false,
		initialOrder = appConfig.pagination.sortOrder || 'date',
	} = options || {}

	const sortOrder = bindOrderQuery
		? useHydratedQuery(bindOrderQuery, useRouteQuery(bindOrderQuery, initialOrder))
		: ref<ArticleOrderType>(initialOrder)

	const booleanQueryTransformer = {
		get: (val: string) => val === 'true',
		set: (val: boolean) => val.toString(),
	}

	const isAscending = bindDirectionQuery
		? useHydratedQuery(bindDirectionQuery, useRouteQuery(bindDirectionQuery, initialAscend.toString(), { transform: booleanQueryTransformer }))
		: ref<boolean>(initialAscend)

	// mx 里没改过的文章 `updated` 是空的，按创建时间算
	const listSorted = computed(() => orderBy(
		toValue(list),
		[(item: T) => item[sortOrder.value] ?? item.date, 'date'],
		[isAscending.value ? 'asc' : 'desc'],
	))

	return {
		sortOrder,
		isAscending,
		listSorted,
	}
}
