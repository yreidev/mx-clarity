import type { MxFetch } from '~/utils/mx/client'
import type { MxFailure } from '~/utils/mx/errors'
import { browserMxClient } from '~/utils/mx/browser'
import { classifyMxError } from '~/utils/mx/errors'

/**
 * 浏览器里直连 core 的客户端：同源的 `/api/v3`（`NUXT_PUBLIC_MX_BROWSER_API_URL`），按当前页面的内容语言带 `?lang=`。
 * 默认带着读者的 cookie，`anonymous` 时不带。
 * 返回取客户端的函数，在事件处理、`onMounted` 这类只在浏览器里跑的地方调用；服务端渲染时调用会报错（服务端没有这个同源代理）
 */
export function useCoreClient(options: { anonymous?: boolean } = {}) {
	const config = useRuntimeConfig()
	const lang = useRouteLang()
	return () => {
		if (import.meta.server)
			throw new Error('useCoreClient() 只在浏览器里用；服务端取数用 useServerMxClient')
		return browserMxClient(config.public.mxBrowserApiUrl || '/api/v3', $fetch as unknown as MxFetch, lang.value, options.anonymous)
	}
}

/** 浏览器直连时实时连接的地址：与页面同一主机的 `/ws/web`（反向代理交给 core） */
export function coreSocketUrl() {
	const { protocol, host } = window.location
	return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/ws/web`
}

/**
 * 浏览器直连 core 调一次：失败时按 `errorOf` 把 core 的错误换成给读者看的固定文案（中文原文，显示时过 `t()`），
 * 抛出的错误与 `$fetch` 访问本站接口出错时同形（`statusCode`、`data.message`），组件里照旧用 `serverErrorMessage` 取文案
 */
export async function callCore<T>(run: () => Promise<T>, errorOf: (failure: MxFailure) => { statusCode: number, message: string }): Promise<T> {
	try {
		return await run()
	}
	catch (error) {
		// 已经带着固定文案的（本地校验没过、`refuse()`）原样抛
		if (isNuxtError(error))
			throw error
		const { statusCode, message } = errorOf(classifyMxError(error))
		refuse(statusCode, message)
	}
}

/** 抛一个带固定文案的错误（与 `callCore` 抛的同形） */
export function refuse(statusCode: number, message: string): never {
	throw createError({ statusCode, message, data: { message } })
}
