/**
 * 正文里的视频嵌入：只认这几个平台，`id` 按各平台的格式校验后才拼进地址。
 * `id` 来自正文（markdown 里能直接写 `::video-embed{type="…" id="…"}`），不校验就能塞进
 * `javascript:` 地址或任意外站 iframe。认不得的一律返回 undefined，调用方不渲染。纯函数。
 */

export const VIDEO_TYPES = ['raw', 'bilibili', 'bilibili-nano', 'youtube', 'douyin', 'douyin-wide', 'tiktok'] as const
export type VideoType = typeof VIDEO_TYPES[number]

const ID_FORMATS: Record<Exclude<VideoType, 'raw'>, RegExp> = {
	'bilibili': /^BV[\dA-Z]{10}$/i,
	'bilibili-nano': /^BV[\dA-Z]{10}$/i,
	'youtube': /^[\w-]{11}$/,
	'douyin': /^\d{1,24}$/,
	'douyin-wide': /^\d{1,24}$/,
	'tiktok': /^\d{1,24}$/,
}

const HTTP_URL = /^https?:\/\//i
/** 站内路径：单个 `/` 开头（`//host` 是协议相对地址，不算） */
const SITE_PATH = /^\/(?![/\\])/

export function isVideoType(value: unknown): value is VideoType {
	return typeof value === 'string' && (VIDEO_TYPES as readonly string[]).includes(value)
}

/** `raw` 视频与封面的地址：只收站内路径与 http(s) 的绝对地址 */
export function mediaUrlOf(value: unknown) {
	if (typeof value !== 'string' || value.length > 2048)
		return undefined
	// 浏览器解析前会删掉制表符、换行：`/\t/evil.com` 就成了 `//evil.com`，所以站内路径里不许有控制字符与空白
	if (SITE_PATH.test(value))
		return /[\p{Cc}\s]/u.test(value) ? undefined : value
	if (!HTTP_URL.test(value))
		return undefined
	try {
		return new URL(value).href
	}
	catch {
		return undefined
	}
}

/** 播放地址；`type` 或 `id` 不合格返回 undefined */
export function videoSrcOf(type: unknown, id: unknown, autoplay = false) {
	if (!isVideoType(type) || typeof id !== 'string')
		return undefined
	if (type === 'raw')
		return mediaUrlOf(id)
	if (!ID_FORMATS[type].test(id))
		return undefined
	const vid = encodeURIComponent(id)
	switch (type) {
		case 'bilibili':
			return `https://player.bilibili.com/player.html?bvid=${vid}&autoplay=${autoplay}`
		case 'bilibili-nano':
			return `https://www.bilibili.com/blackboard/newplayer.html?bvid=${vid}&autoplay=${autoplay}`
		case 'youtube':
			// YouTube 的隐私增强模式：播放前不设 cookie，也不去请求 doubleclick 的广告地址
			return `https://www.youtube-nocookie.com/embed/${vid}?rel=0&disablekb=1&playsinline=1&autoplay=${autoplay}`
		case 'douyin':
		case 'douyin-wide':
			return `https://open.douyin.com/player/video?vid=${vid}`
		case 'tiktok':
			return `https://www.tiktok.com/embed/v3/${vid}`
	}
}
