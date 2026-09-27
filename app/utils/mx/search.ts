/**
 * 站内搜索。纯模块，服务端与浏览器（搜索弹窗直连 core）共用。
 */
import type { SearchHit, SearchPage } from '../../types/search'
import type { MxClient } from './client'
import { searchHitFrom } from './adapter'

export const SEARCH_PAGE_SIZE = 20
/** 关键词上限；core 不限，太长的查询没有意义 */
export const SEARCH_KEYWORD_MAX = 50

interface RawSearchPage {
	data?: Parameters<typeof searchHitFrom>[0][]
	pagination?: { currentPage?: number, totalPage?: number, total?: number }
}

/**
 * `GET /search?keyword=` 一次搜文章、日记、独立页。
 * 响应是双层 `data`、分页字段是 `current_page` / `total_page`，与别的列表不同，api-client 不会整理，这里直接走 proxy
 */
export async function loadSearch(client: MxClient, keyword: string, page: number): Promise<SearchPage> {
	const res = await client.proxy('search').get<RawSearchPage>({ params: { keyword, page, size: SEARCH_PAGE_SIZE } }) as unknown as RawSearchPage
	const now = Date.now()
	const items = (res.data ?? []).map(item => searchHitFrom(item, now)).filter((hit): hit is SearchHit => hit !== undefined)
	return {
		items,
		page: res.pagination?.currentPage ?? page,
		totalPages: Math.max(1, res.pagination?.totalPage ?? 1),
		total: res.pagination?.total ?? items.length,
	}
}
