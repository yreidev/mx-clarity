import type { UiLang } from '~~/shared/utils/i18n'
import { allControllers, createClient, simpleCamelcaseKeys } from '@mx-space/api-client'
/**
 * mx-space api-client 的唯一构造点。
 *
 * 纯模块：不依赖 Nuxt 运行时，Nitro 路由和单测都从这里取 client；浏览器的 client 由 browser.ts 用它建。
 */
import apiClientPackage from '@mx-space/api-client/package.json'
import { uiLangOf } from '~~/shared/utils/i18n'
import { ORIGINAL_LANG } from '~~/shared/utils/lang'

/** 单语言站，所有请求强制带 `?lang=zh`。它进 core 的缓存键，能挡住跨访客的语言污染 */
/** 装的 api-client 版本（启动日志与侧栏技术信息用） */
export const API_CLIENT_VERSION: string = apiClientPackage.version

export const SITE_LANG = 'zh'

/** URL 形态的对象键（如 `enrichments` 的键）不做 camelCase */
export function isUrlKey(key: string) {
	return /^[a-z][\w+.-]*:\/\//i.test(key)
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * 本模块对 fetch 的最小要求：ofetch 的调用形态。Nuxt 与 Nitro 的 `$fetch` 泛型签名彼此不兼容，
 * 也与 ofetch 的 `$Fetch` 类型不兼容，所以只声明用到的字段。
 */
export type MxFetch = (url: string, options: MxFetchOptions) => Promise<unknown>

/** 本模块实际传给 fetch 的选项 */
interface MxFetchOptions {
	method: Method
	query: Record<string, unknown>
	body?: Record<string, unknown>
	headers: Record<string, string>
	timeout?: number
	retry: false
	/** 浏览器直连时带不带读者的 cookie（browser.ts） */
	credentials?: 'include' | 'omit'
}

export interface MxClientOptions {
	/** 生产是 `${serverUrl}/api/v3`；core 以开发模式运行时没有前缀 */
	baseURL: string
	/** Nuxt / Nitro 的 `$fetch`；单测里换成 ofetch 的 createFetch 造的假实例 */
	fetch: MxFetch
	/** 请求的语言，默认站点语言；只有取 AI 译文的原文时才换成原文的语言 */
	lang?: string
	/** 附加请求头。SSR 时放新建的 `X-Forwarded-For`（访客 IP） */
	headers?: Record<string, string>
	/** 单次请求超时，毫秒 */
	timeout?: number
	/** 429 时最多愿意等多久（毫秒）再重试一次；`retry-after` 超过它就不重试 */
	maxRetryWaitMs?: number
	/** 单测注入，默认 setTimeout */
	sleep?: (ms: number) => Promise<void>
}

/** api-client 传给适配器的选项里本模块用到的部分（其 `RequestOptions` 类型未从包入口导出） */
interface AdapterRequestOptions {
	params?: Record<string, unknown> | URLSearchParams
	data?: Record<string, unknown>
	headers?: Record<string, string>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** 429 响应的 `retry-after`（毫秒）；不是 429 或没带该头时返回 undefined */
export function retryAfterMs(error: unknown): number | undefined {
	const response = (error as { response?: Response } | undefined)?.response
	if (response?.status !== 429)
		return undefined
	const seconds = Number(response.headers.get('retry-after'))
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

async function withRateLimitRetry<T>(run: () => Promise<T>, maxWaitMs: number, sleep: (ms: number) => Promise<void>) {
	try {
		return await run()
	}
	catch (error) {
		const wait = retryAfterMs(error)
		if (wait === undefined || wait > maxWaitMs)
			throw error
		await sleep(wait)
		return run()
	}
}

function toQuery(params: AdapterRequestOptions['params']): Record<string, unknown> {
	if (!params)
		return {}
	return params instanceof URLSearchParams ? Object.fromEntries(params) : params
}

/** 每个 client 取数用的语言：渲染正文时按它选界面语言（正文里主题生成的文字：占位、链接卡片的属性名……） */
const CLIENT_LANGS = new WeakMap<object, string>()

export function createMxClient(options: MxClientOptions) {
	const { fetch, headers, timeout, maxRetryWaitMs = 0, sleep = defaultSleep, lang = SITE_LANG } = options

	function request<P>(method: Method, url: string, o: AdapterRequestOptions = {}) {
		const run = () => fetch(url, {
			method,
			// api-client 已把分页参数拼进 url，这里的 query 由 ofetch 与之合并；lang 放最后，强制为站点语言（或指定的原文语言）
			query: { ...toQuery(o.params), lang },
			body: o.data,
			headers: { ...headers, ...o.headers },
			timeout,
			// ofetch 默认对 GET 的 429 / 5xx / 网络错误立即重试一次；这里只对 429 按 retry-after 等一次，全部关掉由下面接管
			retry: false,
		})
		// 只重试 GET：写请求被限流时交给调用方决定
		return (method === 'GET' ? withRateLimitRetry(run, maxRetryWaitMs, sleep) : run()) as Promise<{ data: P }>
	}

	const adapter = {
		default: fetch,
		get: <P>(url: string, o?: AdapterRequestOptions) => request<P>('GET', url, o),
		post: <P>(url: string, o: AdapterRequestOptions) => request<P>('POST', url, o),
		put: <P>(url: string, o: AdapterRequestOptions) => request<P>('PUT', url, o),
		patch: <P>(url: string, o: AdapterRequestOptions) => request<P>('PATCH', url, o),
		delete: <P>(url: string, o?: AdapterRequestOptions) => request<P>('DELETE', url, o),
		responseWrapper: {},
	}

	// 不覆盖 getDataFromResponse，否则 res.pagination 会丢
	const client = createClient(adapter)(options.baseURL, {
		controllers: allControllers,
		transformResponse: data => simpleCamelcaseKeys(data, { shouldSkipKey: isUrlKey }),
	})
	CLIENT_LANGS.set(client, lang)
	return client
}

export type MxClient = ReturnType<typeof createMxClient>

/** 这个 client 取来的内容该配哪种界面语言：站点语言与看原文是中文，译文按它的语言（日、韩有自己的界面，其余英文） */
export function uiLangOfClient(client: MxClient): UiLang {
	const lang = CLIENT_LANGS.get(client)
	return lang && lang !== SITE_LANG && lang !== ORIGINAL_LANG ? uiLangOf(lang) : 'zh'
}
