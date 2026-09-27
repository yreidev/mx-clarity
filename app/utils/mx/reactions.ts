/**
 * 点赞与碎碎念的赞 / 踩。纯模块，浏览器直连 core 时调用。
 *
 * 去重都在 core 那边按访客 IP 做，浏览器直接请求，core 看到的就是访客自己的 IP。
 * 「我赞过没有」不信详情里的 `isLiked`：core 按网址缓存 15 秒，会把别人的结果给你，由浏览器自己记。
 */
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { msg } from '~~/shared/utils/i18n'
import { classifyMxError } from './errors'
import { objectField } from './validate'

export type LikeKind = 'post' | 'note'
export type Attitude = 'up' | 'down'

/** 点赞。同一 IP 已经赞过时 core 回 400 `ALREADY_SUPPORTED`，这里当成功，只是没有计入 */
export async function likeContent(client: MxClient, kind: LikeKind, id: string) {
	try {
		// api-client 的类型只写了首字母大写的 Post / Note，它自己会转小写（core 两种都收）
		await client.activity.likeIt(kind === 'post' ? 'Post' : 'Note', id)
		return { counted: true }
	}
	catch (error) {
		if (classifyMxError(error).code === 'ALREADY_SUPPORTED')
			return { counted: false }
		throw error
	}
}

function countOf(value: unknown) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/**
 * 给碎碎念投票：没投过记上、再投同一个撤销、投另一个改票（core 的规则）。
 * 返回投完之后本人的态度和重新取的计数——本机记的态度可能和 core 按 IP 记的不一致（换了浏览器），
 * 计数以 core 为准；重新取时带 `ts` 绕过 15 秒缓存
 */
export async function voteThinking(client: MxClient, id: string, attitude: Attitude) {
	const result = await client.proxy('recently')('attitude')(id).post<unknown>({ params: { attitude: attitude === 'up' ? 0 : 1 } })
	const item = objectField(await client.proxy('recently')(id).get<unknown>({ params: { ts: Date.now() } }))
	return {
		attitude: objectField(result).code === 1 ? attitude : null,
		up: countOf(item.up),
		down: countOf(item.down),
	}
}

/** 失败时给访客看的提示，只用固定文案 */
export function reactionErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.kind) {
		case 'not-found':
			return { statusCode: 404, message: msg('error.contentDoesntExist') }
		case 'rate-limited':
			return { statusCode: 429, message: msg('error.youreClickingToo') }
		case 'invalid-request':
			return { statusCode: 400, message: msg('common.invalidRequestPlease') }
		default:
			return { statusCode: 503, message: msg('common.couldntDoRight') }
	}
}
