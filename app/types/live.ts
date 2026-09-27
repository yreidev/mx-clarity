import type { CommentProps } from './comment'
/**
 * 实时活动：浏览器直连 core 的 `/ws/web`，收到的帧由 app/utils/mx/live.ts 认、拆、组装成下面这些主题自己的消息，
 * 页面组件只认它们，不直接碰 core 的线协议。
 */
export type LiveServerMessage
	= | { type: 'online', count: number }
		| { type: 'read', kind: 'post' | 'note', id: string, count: number }
		| { type: 'pong' }
		/** 有新文章或日记发布：只是信号，内容由浏览器经 HTTP 取（core 的广播对加密日记也带全文） */
		| { type: 'published' }
		/** 当前房间（这一篇）里的新评论，已按公开评论的白名单重新组装 */
		| { type: 'comment', comment: CommentProps, rootId?: string }
		| { type: 'comment-delete', id: string }
		/** 同一篇里别的读者读到哪了；`identity` 是服务端算的不透明标识 */
		| { type: 'presence', identity: string, position: number, name: string }
		| { type: 'presence-leave', identity: string }
		| { type: 'presence-list', items: { identity: string, position: number, name: string }[] }
		/** 这一篇的译文更新了 */
		| { type: 'translation', refId: string, lang: string }
		/** 站长「此刻」变了；null 是没有了 */
		| { type: 'live-desk', desk: LiveDesk | null }
		/** 「此刻」变了（版本号），去本站取映射好的那份 */
		| { type: 'live-desk-changed', epoch: string, revision: number }
		/** 当前这一篇（文章、日记、独立页）被站长改了：只是信号，内容由浏览器经 HTTP 重取 */
		| { type: 'content-updated', id: string }
		/** 当前这一篇被删除或下线了 */
		| { type: 'content-removed', id: string }
		/** 一条评论被作者改了：正文已按评论的白名单重新渲染 */
		| { type: 'comment-edit', id: string, body: CommentProps['body'], editedAt: string }
		/** 浏览器端自己发的：断线后又连上了（断线期间的变化可能丢了，要的就重新取一次） */
		| { type: 'reconnected' }

/** 侧栏「阅读」挂件的一条 */
export interface ReadingEntry {
	title: string
	path: string
	/** 正在读的人数，或累计阅读次数 */
	count: number
}

export interface ReadingBoard {
	/** 此刻有人在读的，人多的在前，最多 5 条 */
	now: ReadingEntry[]
	/** 累计阅读次数最多的文章与日记 */
	top: ReadingEntry[]
	/** 每篇公开内容此刻的在读人数（键是站内路径），头部的「N 人在读」用 */
	counts: Record<string, number>
}

/** 站长「此刻」：在用的应用、在听的歌（只有文字） */
export interface LiveDesk {
	epoch: string
	/** 同一 epoch 里单调递增，用来丢掉过期的推送 */
	revision: number
	expiresAt?: string
	/** `icon` 是经主题服务器转发的本站地址 */
	app?: { name: string, label?: string, window?: string, icon?: string }
	media?: {
		kind: 'music' | 'podcast' | 'video' | 'unknown'
		title: string
		artist: string
		album?: string
		playing: boolean
		/** 封面，经主题服务器转发的本站地址 */
		artwork?: string
		/** 在 QQ 音乐或网易云里打开这首歌 */
		link?: string
		/** 下发那一刻已播到哪（毫秒，主题按自己的时间推算好的）；浏览器以收到的时刻为起点按 `rate` 往前推 */
		positionMs?: number
		durationMs?: number
		rate?: number
	}
}

/** 站长状态：表情加一句话，到期自动消失 */
export interface OwnerStatus {
	emoji: string
	desc: string
	untilAt?: string
}
