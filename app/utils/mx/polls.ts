/**
 * 投票（Lexical 的 poll 块）：取状态与投票。纯模块，浏览器直连 core 时调用。
 *
 * - core 对游客的 GET 按网址缓存 15 秒，缓存里带着第一个访客的 `user_vote`：取状态**必须带 `ts`**；
 * - 主题的 client 会把响应的键转成 camelCase，`tallies` 的键 `o_xxx` 会被改坏：请求 `transformResponse: false`，自己映射 snake_case；
 * - 业务错误（没有这个投票、已截止、已经投过……）core 回 HTTP 200 + `status: 'error'`，这里映射成固定中文文案，不显示 core 的英文。
 */
import type { PollState } from '../../types/poll'
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { msg } from '~~/shared/utils/i18n'
import { objectField } from './validate'

export const OPTION_ID = /^o_[\da-z]{1,62}$/i

const ERRORS: Record<string, string> = {
	'Poll not found': msg('content.pollNotFound'),
	'Poll closed': msg('content.pollHasClosed'),
	'No option selected': msg('content.pleaseChooseOption'),
	'Duplicate option': msg('content.duplicateOptions'),
	'Multiple options not allowed': msg('content.pollAllowsOnly'),
	'Invalid option': msg('content.invalidOptionPlease'),
	'Already voted': msg('content.youveAlreadyVoted'),
}

/** core 的一个状态（snake_case）→ 主题的结构；计数只留合法的选项 id 与非负整数 */
export function pollStateFrom(raw: unknown): PollState {
	const data = objectField(raw)
	const tallies: Record<string, number> = {}
	for (const [id, count] of Object.entries(objectField(data.tallies))) {
		if (OPTION_ID.test(id) && Number.isSafeInteger(count) && (count as number) >= 0)
			tallies[id] = count as number
	}
	const totalVotes = Number.isSafeInteger(data.total_votes) && (data.total_votes as number) >= 0 ? data.total_votes as number : 0
	const userVote = Array.isArray(data.user_vote) ? data.user_vote.filter((id): id is string => typeof id === 'string' && OPTION_ID.test(id)) : []
	const state: PollState = { tallies, totalVotes, userVote, closed: data.closed === true, canVote: data.can_vote === true }
	if (data.status === 'error')
		state.error = (typeof data.error_message === 'string' && ERRORS[data.error_message]) || msg('content.votingUnavailableRight')
	return state
}

/** 批量取状态：键是投票 id；core 没给的当作找不到 */
export async function loadPollStates(client: MxClient, ids: string[]): Promise<Record<string, PollState>> {
	const raw = objectField(await client.proxy('polls').get<unknown>({ params: { ids: ids.join(','), ts: Date.now() }, transformResponse: false } as never))
	return Object.fromEntries(ids.map(id => [id, raw[id] === undefined ? pollStateFrom({ status: 'error', error_message: 'Poll not found' }) : pollStateFrom(raw[id])]))
}

export async function submitVote(client: MxClient, pollId: string, optionIds: string[]): Promise<PollState> {
	return pollStateFrom(await client.proxy('polls')(pollId)('vote').post<unknown>({ data: { optionIds }, transformResponse: false } as never))
}

/** 请求失败（不是业务错误）→ 固定文案 */
export function pollErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.kind) {
		case 'rate-limited':
			return { statusCode: 429, message: msg('common.tooManyRequests') }
		case 'invalid-request':
			return { statusCode: 400, message: msg('content.invalidParametersPlease') }
		case 'unavailable':
			return { statusCode: 503, message: msg('content.votingTemporarilyUnavailable') }
		default:
			return { statusCode: 500, message: msg('content.votingTemporarilyUnavailable') }
	}
}
