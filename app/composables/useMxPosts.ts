import type { ArticleDetail, ArticleProps } from '~/types/article'
import { safelyDecodeUriComponent } from '~~/shared/utils/link'

/**
 * 全部已发布文章的卡片数据：走 Nitro 缓存的 `/api/mx/posts`。
 * 首页、归档、前后篇共用同一个 key，客户端导航时直接复用已加载的数据。
 */
export function useMxPosts() {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData<ArticleProps[]>(
		() => langKeyOf('mx-posts', lang.value),
		() => fetcher<ArticleProps[]>('/api/mx/posts', { query: { lang: lang.value } }),
		{ default: () => [] },
	)
}

/**
 * 详情数据的 key（文章与日记共用），`useArticle()` 按页面路径找它。
 * 路径解码后再拼：存的一方拿编码过的地址（`/posts/%E6%8A%80…`），找的一方拿的是 vue-router 解码过的 `route.path`
 */
export function mxPostKey(path: string) {
	return `mx-post:${safelyDecodeUriComponent(path)}`
}

/**
 * 文章详情。用 `useRequestFetch` 让 SSR 时的内部调用带上访客的请求头，
 * server 路由据此取访客 IP。
 */
export function useMxPost(category: MaybeRefOrGetter<string>, slug: MaybeRefOrGetter<string>, original?: MaybeRefOrGetter<boolean>) {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	const path = computed(() => `/posts/${encodeURIComponent(toValue(category))}/${encodeURIComponent(toValue(slug))}`)
	// 前缀版带上语言，看原文带 `original`；key 用页面自己的地址（含前缀），目录挂件照常找得到
	return useAsyncData<ArticleDetail>(
		() => mxPostKey(localePath(path.value, lang.value)),
		() => fetcher<ArticleDetail>(`/api/mx${path.value}`, { query: { lang: toValue(original) ? ORIGINAL_LANG : lang.value } }),
		{ watch: [() => toValue(original)] },
	)
}

/**
 * 草稿预览。key 用预览页自己的路径，目录挂件经 `useArticle()` 照常找得到
 */
export function useMxDraftPreview(token: MaybeRefOrGetter<string>) {
	const fetcher = useRequestFetch()
	const path = computed(() => `/preview/${encodeURIComponent(toValue(token))}`)
	return useAsyncData<import('~/types/draft').DraftPreview>(
		() => mxPostKey(path.value),
		() => fetcher<import('~/types/draft').DraftPreview>(`/api/mx${path.value}`),
	)
}
