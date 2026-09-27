/**
 * 站点配置的取数与降级链。
 *
 * `/aggregate` 在没有公开可见的日记时必定 404（它顺带查最新一篇已发布、没加密、已到公开时间的日记，查不到就整个失败），所以它失败时退到
 * `/aggregate/site`；那里没有站长头像，再从公开的 `/owner` 补（只取名字与头像，它还带着站长邮箱）。
 * 两级都失败就抛出，由调用方再退到 blog.config.ts 的静态值。
 */
import type { SiteConfig } from '../../types/site'
import type { MxClient } from './client'
import { siteConfigFromAggregate, siteConfigFromSiteInfo } from './adapter'

/** `onFallback`：第一级失败、改走第二级时回调（服务端用来记降级日志） */
export async function loadSiteConfig(client: MxClient, onFallback?: (error: unknown) => void): Promise<SiteConfig> {
	let firstError: unknown
	try {
		return siteConfigFromAggregate(await client.aggregate.getAggregateData<Record<string, unknown>>())
	}
	catch (error) {
		firstError = error
		onFallback?.(error)
	}
	try {
		const [info, owner] = await Promise.all([
			client.aggregate.getSiteMetadata(),
			client.owner.getOwnerInfo().then(res => res as unknown as { name?: string, avatar?: string }).catch(() => undefined),
		])
		return siteConfigFromSiteInfo(info, owner)
	}
	catch {
		throw firstError
	}
}

/** core 的版本：公开的 `GET /info` 返回 `{ data: { version } }`。认不出时是空串 */
export async function loadCoreVersion(fetchJson: (path: string) => Promise<unknown>): Promise<string> {
	const version = (await fetchJson('/info') as { data?: { version?: unknown } } | undefined)?.data?.version
	return typeof version === 'string' && /^[\w.+-]{1,40}$/.test(version) ? version : ''
}
