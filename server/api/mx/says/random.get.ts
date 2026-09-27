import type { SayProps } from '~~/app/types/note'
import { loadAllSays } from '~~/app/utils/mx/home'

/** 全部说说（最多 200 条），全站缓存 10 分钟。不转发 core 的 `/says/random`：它每次读整张表，还按网址缓存 15 秒 */
const getCachedAllSays = defineCachedFunction(
	() => loadAllSays(useServerMxClient()),
	{ name: 'mx-says-all', maxAge: 600, swr: true, getKey: () => 'all' },
)

/** 随机一条说说；`except` 是现在显示的那条，换一条时尽量不重复。没有说说时是 null */
export default defineEventHandler(async (event): Promise<SayProps | null> => {
	setHeader(event, 'cache-control', 'no-store')
	const says = await getCachedAllSays().catch((error) => {
		throw toHttpError(error, 'says-random')
	})
	const except = getQuery(event).except
	const pool = says.length > 1 ? says.filter(say => say.id !== except) : says
	return pool[Math.floor(Math.random() * pool.length)] ?? null
})
