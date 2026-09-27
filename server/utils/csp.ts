/**
 * 页面的内容安全策略（CSP）：每个请求一个随机 nonce，只有带着它的脚本能执行，
 * 由它们再加载的脚本（分块、mermaid、站长的统计脚本加载的）靠 `'strict-dynamic'` 放行。
 * 纯函数，插件 server/plugins/security-headers.ts 在渲染时调用。
 */
import { createHash, randomBytes } from 'node:crypto'

export type CspMode = 'enforce' | 'report-only' | 'off'

/** `NUXT_CSP`：`enforce`（默认）、`report-only`（只在控制台报、不拦）、`off`（只留最小 CSP） */
export function cspModeOf(value: unknown): CspMode {
	return value === 'report-only' || value === 'off' ? value : 'enforce'
}

export function createNonce() {
	return randomBytes(16).toString('base64')
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/** NuxtImg / NuxtPicture 服务端渲染时写在 `<img>` 上的内联 onerror（水合前图片加载失败时做个记号） */
const NUXT_IMG_ONERROR = sha256(`this.setAttribute('data-error', 1)`)

/** 外部样式表：与 nuxt.config.ts 的 `app.head.link` 一一对应，改那边要同步改这里 */
const STYLE_HOSTS = ['https://s4.zstatic.net', 'https://fonts.googleapis.cn', 'https://fonts.bytedance.com']

/** 视频嵌入的播放器（shared/utils/video.ts 只会拼出这几个域名） */
const FRAME_HOSTS = ['https://player.bilibili.com', 'https://www.bilibili.com', 'https://www.youtube-nocookie.com', 'https://open.douyin.com', 'https://www.tiktok.com']

const SCRIPT_TAG = /<script(?=[\s>])(?![^>]*\snonce=)/gi
const MODULEPRELOAD = /<link(?=[^>]*\srel=["']?modulepreload)(?![^>]*\snonce=)/gi

/**
 * 给一段 HTML 里的 `<script>` 与 `<link rel="modulepreload">` 加上 nonce（已有的不动）。
 * 只用在 Nuxt 与模块自己生成的 head、body 首尾，**不要用在正文上**：正文里混进来的脚本加了 nonce 就等于放行
 */
export function withNonce(html: string, nonce: string) {
	return html.replace(SCRIPT_TAG, `<script nonce="${nonce}"`).replace(MODULEPRELOAD, `<link nonce="${nonce}"`)
}

const HOST = /^[\w-]+(?:\.[\w-]+)*(?::\d{1,5})?$/

function originOf(url: string) {
	try {
		const { origin, protocol } = new URL(url)
		return protocol === 'https:' ? origin : undefined
	}
	catch {
		return undefined
	}
}

export interface CspInput {
	nonce: string
	/** 请求的 Host：实时连接要显式写 `wss://<Host>`（老 Safari 的 'self' 不含 wss） */
	host?: string
	/** 主题配置里站长加的脚本：脚本所在的域名与它声明的 `connect` 域名放进 connect-src */
	scripts: { src: string, connect?: string[] }[]
	/** 除本站外还允许嵌套页面的站点（NUXT_FRAME_ANCESTORS，已校验） */
	frameAncestors: string[]
}

/** 地图块的底图（maplibre 的样式、瓦片、字形、雪碧图都从这里取） */
const MAP_TILE_HOST = 'https://tiles.openfreemap.org'

export function contentSecurityPolicyOf({ nonce, host, scripts, frameAncestors }: CspInput) {
	const connect = new Set(['\'self\'', MAP_TILE_HOST])
	if (host && HOST.test(host))
		connect.add(`wss://${host}`)
	for (const script of scripts) {
		const origin = originOf(script.src)
		if (origin)
			connect.add(origin)
		for (const target of script.connect ?? [])
			connect.add(target)
	}
	return [
		`default-src 'self'`,
		// https: 与 'unsafe-inline' 只给不认 nonce / strict-dynamic 的老浏览器；认的浏览器会忽略它们
		`script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-hashes' ${NUXT_IMG_ONERROR} 'wasm-unsafe-eval' https: 'unsafe-inline'`,
		`style-src 'self' 'unsafe-inline' ${STYLE_HOSTS.join(' ')}`,
		`font-src 'self' data: https:`,
		`img-src 'self' data: blob: https:`,
		`media-src 'self' data: blob: https:`,
		`frame-src ${FRAME_HOSTS.join(' ')}`,
		`connect-src ${[...connect].join(' ')}`,
		// maplibre 的瓦片 worker：打包成本站的文件；'strict-dynamic' 下 script-src 的 'self' 不算数，要显式写
		`worker-src 'self' blob:`,
		`object-src 'none'`,
		`base-uri 'self'`,
		`form-action 'self'`,
		`frame-ancestors 'self'${frameAncestors.map(origin => ` ${origin}`).join('')}`,
	].join('; ')
}

/** 一直生效的最小 CSP：`NUXT_CSP=off` 或只报不拦时也带着 */
export function minimalPolicyOf(frameAncestors: string[]) {
	return [`frame-ancestors 'self'${frameAncestors.map(origin => ` ${origin}`).join('')}`, `object-src 'none'`, `base-uri 'self'`].join('; ')
}

/**
 * 订阅源（XML）的内容安全策略：浏览器直接打开时经 atom.xsl 渲染成页面，与站点同源。
 * 只放行同源的样式与脚本（atom.css、atom.js）和 https 图片，别的一概不许
 */
export const FEED_CSP = 'default-src \'none\'; style-src \'self\'; script-src \'self\'; img-src https: data:; base-uri \'none\'; form-action \'none\'; frame-ancestors \'none\''
