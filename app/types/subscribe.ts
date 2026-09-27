/** 邮件订阅：core 只在发文章（`post_c`）、日记（`note_c`）时发信 */
export type SubscribeType = 'post_c' | 'note_c'

export interface SubscribeStatus {
	/** 站长开了邮件订阅（并配好了发信） */
	enable: boolean
	/** 能订阅的内容 */
	types: SubscribeType[]
}
