import type { NoteDetail, NoteProps, Paged, SayProps, ThinkingProps, TopicDetail, TopicProps } from '~/types/note'

/**
 * 日记、专栏、说说、碎碎念的取数，都走 Nuxt 的 server 路由。
 * key 随参数变化，翻页时自动重新取数。
 */

export function useMxNotes(page: MaybeRefOrGetter<number>) {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData(
		() => langKeyOf(`mx-notes:${toValue(page)}`, lang.value),
		() => fetcher<Paged<NoteProps>>('/api/mx/notes', { query: { page: toValue(page), lang: lang.value } }),
	)
}

/** 与文章详情共用 key 规则，`useArticle()` 据此找到目录给侧栏挂件 */
export function useMxNote(nid: MaybeRefOrGetter<number>, original?: MaybeRefOrGetter<boolean>) {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData(
		() => mxPostKey(localePath(`/notes/${toValue(nid)}`, lang.value)),
		() => fetcher<NoteDetail>(`/api/mx/notes/${toValue(nid)}`, { query: { lang: toValue(original) ? ORIGINAL_LANG : lang.value } }),
		{ watch: [() => toValue(original)] },
	)
}

export function useMxTopics() {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData(() => langKeyOf('mx-topics', lang.value), () => fetcher<TopicProps[]>('/api/mx/topics', { query: { lang: lang.value } }), { default: () => [] })
}

export function useMxTopic(slug: MaybeRefOrGetter<string>, page: MaybeRefOrGetter<number>) {
	const fetcher = useRequestFetch()
	const lang = useRouteLang()
	return useAsyncData(
		() => langKeyOf(`mx-topic:${toValue(slug)}:${toValue(page)}`, lang.value),
		() => fetcher<TopicDetail>(`/api/mx/topics/${encodeURIComponent(toValue(slug))}`, { query: { page: toValue(page), lang: lang.value } }),
	)
}

export function useMxSays(page: MaybeRefOrGetter<number>) {
	const fetcher = useRequestFetch()
	return useAsyncData(
		() => `mx-says:${toValue(page)}`,
		() => fetcher<Paged<SayProps>>('/api/mx/says', { query: { page: toValue(page) } }),
	)
}

export interface ThinkingPage {
	items: ThinkingProps[]
	/** 下一页的游标；没有更多时为空 */
	next?: string
}

/** 首屏只取第一页；「加载更多」由页面按游标追加 */
export function useMxThinking() {
	const fetcher = useRequestFetch()
	return useAsyncData('mx-thinking', () => fetcher<ThinkingPage>('/api/mx/thinking'))
}

export function useMxThinkingItem(id: MaybeRefOrGetter<string>) {
	const fetcher = useRequestFetch()
	return useAsyncData(
		() => `mx-thinking:${toValue(id)}`,
		() => fetcher<ThinkingProps>(`/api/mx/thinking/${encodeURIComponent(toValue(id))}`),
	)
}
