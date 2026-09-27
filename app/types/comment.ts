/**
 * 评论的本地类型。页面与组件只认它，不认 api-client 的 `CommentModel`。
 *
 * 评论是匿名可写的，这里的每个字段都已在服务端洗过：
 * 链接只剩 http(s)，头像只剩 https，正文是白名单结构而不是 HTML。
 */
import type { Paged } from './note'

/** 正文里允许的行内元素（评论正文白名单的一部分） */
export type CommentInline
	= | { type: 'text', value: string }
		| { type: 'code', value: string }
		| { type: 'break' }
		| { type: 'strong' | 'em' | 'del', children: CommentInline[] }
		| { type: 'link', href: string, children: CommentInline[] }
		/** 只有站点自己存储的图片（`CommentBodyOptions.imagePrefixes`），别处的图片是链接 */
		| { type: 'image', src: string, alt: string }

/** 正文里的块级元素 */
export type CommentBlock
	= | { type: 'paragraph', children: CommentInline[] }
		| { type: 'code', value: string }
		| { type: 'quote', children: CommentBlock[] }
		| { type: 'list', ordered: boolean, items: CommentBlock[][] }

/** 站长 / 登录读者 / 匿名访客 */
export type CommentIdentity = 'owner' | 'reader' | 'guest'

export interface CommentProps {
	id: string
	/** 纯文本，模板里按插值显示 */
	author: string
	avatar?: string
	/** 访客填的主页，已过协议白名单 */
	url?: string
	body: CommentBlock[]
	date: string
	pinned: boolean
	identity: CommentIdentity
	/** 读者的登录方式（github / google / apple…），匿名访客没有 */
	provider?: string
	/** 读者是会员（只有顶层评论知道：core 不给回复带读者信息） */
	member?: boolean
	/** 回复的直接上级；与所在楼层相同时省略 */
	parentId?: string
	/** 发评论时的「浏览器 · 系统」，只到大版本；主题配置关掉或认不出时没有 */
	agent?: string
	/** 评论者的 IP 归属地，只用来显示（「来自 X」）；站长关了公开归属地、或是登录读者的评论时没有 */
	location?: string
	/** 改过的话是最后一次修改的时间 */
	editedAt?: string
	/**
	 * 登录读者的不透明标识（服务端用进程内的密钥对 core 的读者 id 做 HMAC），
	 * 与 `ReaderSession.tag` 相同就是当前读者自己的评论。不是读者 id 本身
	 */
	authorTag?: string
	/** 评论原文（markdown），只有读者自己的评论在发出后的可编辑时间内才带，给编辑框预填 */
	source?: string
	/** 浏览器端的标记：打开页面之后实时推来的，显示「新」 */
	fresh?: true
	/** 划词评论引用的那段正文（只有顶层评论有） */
	anchor?: CommentAnchor
}

/** 划词评论在评论上的显示：引用在当前正文里还找得到才有块 id 与引用，找不到只说已不在原文中 */
export type CommentAnchor
	= | { blockId: string, quote: string }
		/** 评论整段（mode=block）：`block` 是那一段文字的前 40 字 */
		| { blockId: string, block: string }
		/** 引用（或段落）已不在当前正文里；`mode` 区分说法 */
		| { stale: true, mode?: 'block' }

/** 发划词评论时浏览器交的：块 id、选中的文字、前后文。服务端按正文重新定位，偏移等一概不信浏览器的 */
export interface CommentAnchorDraft {
	blockId: string
	/** `block` 是评论整段（没有引用，quote 等都是空的） */
	mode?: 'range' | 'block'
	quote: string
	prefix: string
	suffix: string
	/** 只在浏览器里显示用：段落评论时那一段的前几十个字（服务端不收） */
	excerpt?: string
}

/** 正文高亮的一条：哪一块、引用、是这段文字在块里的第几处；弹出时显示评论者与摘要 */
export interface CommentHighlight {
	id: string
	blockId: string
	/** `block` 是段落评论（没有引用与序号） */
	mode?: 'block'
	quote: string
	index: number
	author: string
	/** 过了可信名单的头像，没有就不给 */
	avatar?: string
	excerpt: string
	date?: string
	replyCount?: number
}

export interface CommentThread extends CommentProps {
	/** 这一层已拿到的回复，按时间正序 */
	replies: CommentProps[]
	/**
	 * 回复超过 20 条时中段是折叠的：`count` 是折叠的条数，
	 * `cursor` 交给楼中楼的接口取下一批，展开的回复插在头 3 条之后
	 */
	hidden?: { count: number, cursor: string }
}

export type CommentPage = Paged<CommentThread>

export interface CommentThreadBatch {
	replies: CommentProps[]
	/** 没有更多时为空 */
	cursor?: string
}

/** 发评论时浏览器交给 server 路由的内容 */
export interface CommentDraft {
	text: string
	as: 'guest' | 'reader'
	/** 回复哪一条；顶层评论不带 */
	parentId?: string
	/** 悄悄话：只有站长能看到 */
	whisper?: boolean
	/** 匿名身份才需要 */
	guest?: {
		author: string
		mail: string
		url?: string
	}
	/** 划词评论：只有顶层评论能带 */
	anchor?: CommentAnchorDraft
}

/**
 * 发完之后的去向：`visible` 已公开，页面原地插入；`pending` 要等站长审核；
 * `whisper` 是悄悄话，公开列表里永远看不到
 */
export type CommentSubmitStatus = 'visible' | 'pending' | 'whisper'

export interface CommentSubmitResult {
	comment: CommentProps
	status: CommentSubmitStatus
}

/** 当前登录的读者。不含邮箱等其余字段 */
export interface ReaderSession {
	name: string
	avatar?: string
	provider?: string
	isOwner: boolean
	/** 与 `CommentProps.authorTag` 同一种标识，用来认出自己的评论 */
	tag?: string
}

/** 列表的排序：置顶在前（core 的默认）、最新、最早 */
export type CommentSort = 'pinned' | 'newest' | 'oldest'

/** 编辑完的评论：正文由服务端按同一套白名单重新渲染 */
export interface CommentEditResult {
	body: CommentBlock[]
	editedAt: string
}

/** 按 id 找到的评论所在的那一层楼，`targetId` 是要高亮的那一条（可能是楼主，也可能是其中一条回复） */
export interface CommentLocateResult {
	thread: CommentThread
	targetId: string
}

/**
 * 「我的评论」里一条的状态：`visible` 公开列表里看得到；`pending` 看不到，多半在等站长审核；
 * `whisper` 悄悄话；`unknown` 查不出来（楼层太长、core 暂时不可用），不标
 */
export type MyCommentStatus = 'visible' | 'pending' | 'whisper' | 'unknown'

/** 「我的评论」里的一条 */
export interface MyComment {
	id: string
	body: CommentBlock[]
	date: string
	status: MyCommentStatus
	/** 所在内容的站内地址（已带 `#comment-<id>`）；原文删了时没有 */
	path?: string
	/** 所在内容的标题，纯文本、限长 */
	title?: string
}

export type MyCommentPage = Paged<MyComment>

export interface ReaderState {
	reader: ReaderSession | null
	/** core 上已配置的社交登录方式；为空时不显示登录按钮 */
	providers: string[]
}
