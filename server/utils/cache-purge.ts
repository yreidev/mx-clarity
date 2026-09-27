/**
 * 按缓存名清掉 Nitro 的缓存（webhook 用）。`defineCachedFunction` 的键是 `nitro:functions:<名字>:<键>.json`，
 * `defineCachedEventHandler` 的是 `nitro:handlers:<名字>:<键>.json`，都在 `useStorage('cache')` 里。
 *
 * 同一个名字 3 秒内只清一次（防被刷）；20 秒后再清一次：core 自己对公开接口有 15 秒的缓存，
 * 立刻回源可能拿到旧值，swr 的后台刷新也可能在清掉之后把旧值写回来。
 * 清掉的缓存有会进页面的（`affectsPages`），整页缓存（server/utils/page-cache.ts）也跟着整个清，第二遍同样；
 * 只清了订阅源、「最近动态」这类不进页面的（比如来了新评论），整页缓存不动
 */
import { affectsPages } from '~~/app/utils/mx/webhook'

const COALESCE = 3000
const SECOND_PASS = 20_000
const lastPurged = new Map<string, number>()
const pending = new Set<string>()

async function removeByName(name: string) {
	const storage = useStorage('cache')
	for (const group of ['nitro:functions', 'nitro:handlers']) {
		const prefix = `${group}:${name}:`
		const keys = (await storage.getKeys(`${group}:${name}`)).filter(key => key.startsWith(prefix))
		await Promise.all(keys.map(key => storage.removeItem(key)))
	}
}

/** 清这些缓存；返回这次真的清了的名字（3 秒内清过的跳过） */
export async function purgeCaches(names: readonly string[], now = Date.now()) {
	const fresh = [...new Set(names)].filter(name => now - (lastPurged.get(name) ?? 0) >= COALESCE)
	for (const name of fresh)
		lastPurged.set(name, now)
	await Promise.all(fresh.map(removeByName))
	if (affectsPages(fresh))
		clearPageCache()
	for (const name of fresh) {
		if (pending.has(name))
			continue
		pending.add(name)
		setTimeout(() => {
			pending.delete(name)
			removeByName(name).then(() => affectsPages([name]) && clearPageCache(), () => undefined)
		}, SECOND_PASS).unref?.()
	}
	return fresh
}
