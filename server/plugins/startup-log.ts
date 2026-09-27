import process from 'node:process'
import { API_CLIENT_VERSION } from '~~/app/utils/mx/client'
import { version } from '~~/package.json'

/** 启动时记一条：主题与 api-client 的版本、Node 版本，排查时知道跑的是哪一版 */
export default defineNitroPlugin(() => {
	logEvent('info', 'mx.start', { theme: version, apiClient: API_CLIENT_VERSION, node: process.version })
})
