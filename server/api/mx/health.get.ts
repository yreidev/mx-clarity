import { classifyMxError } from '~~/app/utils/mx/errors'

/**
 * 给站长的外部监控用：主题活着、core 也连得上就是 200 `{"status":"ok"}`，core 连不上是 503。
 * 探测 core 的 `/api/v3/ping`（3 秒超时），结果缓存 10 秒：这个地址对外公开，不能被拿来刷 core。
 * 只给这两个字段，不带版本与内部地址。镜像自己的健康检查照旧取 /favicon.svg（core 没初始化时主题照样算健康）
 */
const probeCore = defineCachedFunction(
	async () => {
		try {
			await $fetch(`${useRuntimeConfig().mxApiUrl}/ping`, { timeout: 3000, retry: 0 })
			return true
		}
		catch (error) {
			logDegraded('health', classifyMxError(error))
			return false
		}
	},
	{ name: 'mx-health', maxAge: 10, swr: false, getKey: () => 'core' },
)

export default defineEventHandler(async (event) => {
	setHeader(event, 'cache-control', 'no-store')
	if (await probeCore())
		return { status: 'ok' }
	setResponseStatus(event, 503)
	return { status: 'degraded', core: 'down' }
})
