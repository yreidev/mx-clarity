/** 一个投票此刻的状态（`/api/mx/polls`），因人而异（「我投了什么」「还能不能投」） */
export interface PollState {
	/** 选项 id → 选它的人数；没票的选项不在里面 */
	tallies: Record<string, number>
	/** 参与的人数（多选时各项之和会比它大） */
	totalVotes: number
	/** 我投了哪几项 */
	userVote: string[]
	closed: boolean
	canVote: boolean
	/** 固定的中文说明（找不到、已截止、已经投过……） */
	error?: string
}
