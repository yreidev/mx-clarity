import type { PollState } from '~/types/poll'
import type { MxClient } from '~/utils/mx/client'
import { loadPollStates, pollErrorOf, submitVote } from '~/utils/mx/polls'

/**
 * 投票状态的取法：同一页里的投票攒成一次批量请求，浏览器直连 core，只在投票进入视口时取。
 * 状态因人而异，请求带时间戳绕过 core 的 15 秒缓存（缓存里有第一个请求者的选择）；投完直接用投票接口的响应更新。
 * 客户端由组件传进来（`useCoreClient()`），这里没有组件上下文
 */
let queue: { id: string, core: () => MxClient, resolve: (state: PollState | undefined) => void }[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function flush() {
	const batch = queue
	queue = []
	timer = undefined
	const ids = [...new Set(batch.map(item => item.id))].slice(0, 20)
	if (!batch[0])
		return
	loadPollStates(batch[0].core(), ids)
		.then(states => batch.forEach(item => item.resolve(states[item.id])))
		.catch(() => batch.forEach(item => item.resolve(undefined)))
}

export function fetchPollState(core: () => MxClient, id: string) {
	return new Promise<PollState | undefined>((resolve) => {
		queue.push({ id, core, resolve })
		timer ??= setTimeout(flush, 30)
	})
}

export function votePoll(core: () => MxClient, id: string, optionIds: string[]) {
	return callCore(() => submitVote(core(), id, optionIds), pollErrorOf)
}

/** 按 `showResults` 决定现在能不能看结果（投后可见、截止后可见、始终） */
export function pollShowsResults(showResults: string | undefined, state: PollState | undefined) {
	if (!state)
		return false
	if (showResults === 'after-close')
		return state.closed
	if (showResults === 'after-vote')
		return state.closed || state.userVote.length > 0
	return true
}
