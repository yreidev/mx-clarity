import type { MxFailure } from '~~/app/utils/mx/errors'

/**
 * 服务端最近一次向 core 取数失败（连不上、超时、5xx、限流）的时刻。
 * 页面在渲染期间碰上过失败，就可能是用兜底值、错误框拼出来的，不进整页缓存、也不让别的缓存存（server/plugins/page-cache.ts）。
 * 进程内共用一个时刻：别的请求同时失败也会让这一页不缓存，宁可少缓存一次
 */
let lastFailureAt = 0

/** 记一次失败；`not-found`、参数错、鉴权失败是 core 正常的回答，不算 */
export function noteCoreFailure(failure: Pick<MxFailure, 'kind'>, now = Date.now()) {
	if (failure.kind === 'unavailable' || failure.kind === 'rate-limited')
		lastFailureAt = Math.max(lastFailureAt, now)
}

/** `since` 之后（含）有没有失败过 */
export function coreFailedSince(since: number) {
	return lastFailureAt >= since
}

/**
 * 直接用 `$fetch` 请求 core 时抛的错（ofetch 的 FetchError）归成 core 失败没有：
 * 没有响应（连不上、超时）、5xx、429 算，其余（404 之类）不算
 */
export function isCoreFetchFailure(error: unknown) {
	const status = (error as { response?: { status?: number } } | undefined)?.response?.status
	return status === undefined || status >= 500 || status === 429
}
