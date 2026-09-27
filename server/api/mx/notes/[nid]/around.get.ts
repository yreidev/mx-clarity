import type { NoteNeighbors } from '~~/app/types/note'
import { noteNeighborsOf } from '~~/app/utils/mx/explore'

/** 日记详情侧栏的「前后的日记」：从缓存的时间线（游客可见的日记）里取前后各 5 篇，不打 core */
export default defineEventHandler(async (event): Promise<NoteNeighbors> => {
	const nid = Number(getRouterParam(event, 'nid'))
	if (!Number.isInteger(nid) || nid <= 0)
		throw notFound()
	return noteNeighborsOf(await getCachedTimeline().catch(() => []), nid)
})
