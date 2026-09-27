import { readFileSync } from 'node:fs'
import { createFetch } from 'ofetch'
import { createMxClient } from '../../app/utils/mx/client'

/** 读 test/fixtures/mx 下的夹具：形状照 core 的真实响应（线格式，snake_case），内容是示例 */
export function fixture<T = any>(name: string): T {
	return JSON.parse(readFileSync(new URL(`../fixtures/mx/${name}.json`, import.meta.url), 'utf8'))
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		status: 200,
		...init,
		headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
	})
}

type Handler = (request: Request, index: number) => Response | Promise<Response>

/** 造一个记录全部请求的假 `$fetch`，交给 createMxClient */
export function recordingFetch(handler: Handler) {
	const requests: Request[] = []
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init)
		requests.push(request)
		return handler(request, requests.length - 1)
	}
	return { $fetch: createFetch({ fetch }), requests }
}

export const BASE = 'http://mx.test/api/v3'

export function clientWith(handler: Handler, options: Partial<Parameters<typeof createMxClient>[0]> = {}) {
	const { $fetch, requests } = recordingFetch(handler)
	const sleeps: number[] = []
	const client = createMxClient({
		baseURL: BASE,
		fetch: $fetch,
		sleep: async (ms) => { sleeps.push(ms) },
		...options,
	})
	return { client, requests, sleeps }
}
