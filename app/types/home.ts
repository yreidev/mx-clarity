/** 首页聚合挂件的数据：都在服务端按公开集合比对、只挑白名单字段 */

export interface RecentActivity {
	/** 最近评论：昵称纯文本、头像过了可信名单、正文是纯文本开头；被评论的内容一定是公开的 */
	comments: { author: string, avatar?: string, excerpt: string, date: string, title: string, path: string }[]
	/** 最近的碎碎念，只有正文开头的纯文本 */
	thinking: { id: string, excerpt: string, date: string, path: string }[]
}
