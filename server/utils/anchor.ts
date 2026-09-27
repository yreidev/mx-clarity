import type { H3Event } from 'h3'
import type { AnchorBlock } from '~~/app/utils/mx/anchor'
import { anchorBlocksOf } from '~~/app/utils/mx/anchor'
import { parseLexicalState } from '~~/app/utils/mx/lexical'

/**
 * 划词评论要核对的正文块：以**匿名身份**取这篇的正文（付费锁定的部分不在里面），按块 id 算好文字。
 * 日记只认主题缓存的公开时间线里有的（加密、定时公开的都不在里面；按 id 也取不出 nid）。
 * 文章不在时间线里时（刚发布、缓存还没刷新，没配 webhook 时最多十来分钟）照样匿名按 id 取：core 对游客只给已发布的，草稿取不到。
 *
 * 只缓存取到了的（不是 Lexical 正文的存成 `blocks: null`），全站 30 秒；取不到的不存：id 由访客随便填，查不到的也存的话能把缓存塞满、
 * 把站点配置这些缓存挤掉。没命中时转发访客 IP（不转 cookie，仍是匿名），拿不存在的 id 刷，core 的限流落在刷的人身上，不落在主题的 IP 上
 */
const getCachedAnchorBlocks = defineCachedFunction(
	async (refId: string, event?: H3Event): Promise<{ blocks: Record<string, AnchorBlock> | null } | null> => {
		const entry = (await getCachedTimeline().catch(() => [])).find(item => item.id === refId)
		const client = useServerMxClient(event)
		const nid = entry?.type === 'note' ? Number(entry.path.split('/').pop()) : 0
		const raw = await (entry?.type === 'note' ? client.note.getNoteByNid(nid) : client.post.getPost(refId)).catch(() => undefined) as { contentFormat?: string, content?: string } | undefined
		if (!raw)
			return null
		const state = raw.contentFormat === 'lexical' ? parseLexicalState(raw.content) : undefined
		return { blocks: state ? anchorBlocksOf(state) : null }
	},
	{
		name: 'mx-anchor-blocks',
		maxAge: 30,
		getKey: (refId: string, _event?: H3Event) => refId,
		validate: entry => entry.value !== null && entry.value !== undefined,
	},
)

/** 这篇的正文块；不是 Lexical 正文、取不到时是 undefined。`event` 是这次请求，没命中缓存时用它转发访客 IP */
export async function getAnchorBlocks(refId: string, event?: H3Event) {
	return (await getCachedAnchorBlocks(refId, event).catch(() => null))?.blocks ?? undefined
}
