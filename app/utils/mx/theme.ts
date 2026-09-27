/**
 * 主题配置：mx admin 里的 JSON 片段 `theme/mx-clarity`（也认 Yohaku、Shiro 的 `theme/yohaku`、`theme/shiro`）。
 *
 * 先走 `/aggregate?theme=`（core 按顺序取第一个有的片段，并合好 `theme/<名字>.<语言>` 的覆盖）；
 * 站点没有可见日记时 `/aggregate` 必定 404，这时退回 `GET /s/theme/<名字>`（与日记无关，返回存进去的 JSON 原样）。
 * 内容由站长填，照样按不可信处理：链接只收站内路径、http(s) 与 mailto，脚本只收 https，
 * 格式不对的项丢掉并退回默认值，同时给出警告（服务端打日志），页面照常渲染。
 */
import type { Nav, NavItem } from '../../types/nav'
import type { ThemeConfig } from '../../types/theme'
import { msg } from '~~/shared/utils/i18n'
import { CANDIDATE_LANGS, enabledLangsOf } from '~~/shared/utils/lang'
import { safelyDecodeUriComponent } from '~~/shared/utils/link'
import { isValidTimeZone } from '~~/shared/utils/time'
import blogConfig from '../../../blog.config'

export const THEME_NAME = 'mx-clarity'

const SITE_PATH = /^\/(?!\/)\S*$/
const HTTP_URL = /^https?:\/\/[^\s/]\S*$/i
const HTTPS_URL = /^https:\/\/[^\s/]\S*$/i
const MAILTO = /^mailto:[^\s@]+@[^\s@]+$/i
const ICON = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/i
const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const FONT_FAMILY = /^[\p{L}\p{N} _-]{1,40}$/u

/** 跳转不能盖住这些：Nuxt 的资源、本站与 core 的接口 */
const RESERVED_REDIRECT_PREFIXES = ['/_nuxt/', '/_ipx/', '/__', '/api/']

const LIMITS = { text: 200, emoji: 8, nav: 12, sidebarNav: 16, navGroups: 6, blogLog: 30, categories: 50, redirects: 500, scripts: 5 }

export function defaultThemeConfig(): ThemeConfig {
	return {
		subtitle: '',
		header: {
			logo: '',
			showTitle: true,
			emojiTail: ['✨', '📝', '🌱', '☕', '🎈'],
			titleFont: null,
		},
		nav: [
			{ icon: 'tabler:files', text: msg('common.post'), url: '/' },
			{ icon: 'tabler:notebook', text: msg('common.diary'), url: '/notes' },
			{ icon: 'tabler:quote', text: msg('common.quotes'), url: '/says' },
			{ icon: 'tabler:message-circle', text: msg('common.thinking'), url: '/thinking' },
			{ icon: 'tabler:package', text: msg('common.projects'), url: '/projects' },
			{ icon: 'tabler:link', text: msg('common.friends'), url: '/link' },
			{ icon: 'tabler:archive', text: msg('common.archive'), url: '/archive' },
			{ icon: 'tabler:timeline', text: msg('common.timeline'), url: '/timeline' },
		],
		footer: {
			copyright: '© {year} {author}',
			iconNav: [
				{ icon: 'tabler:rss', text: msg('site.atomFeed'), url: '/atom.xml' },
			],
			nav: [
				{
					title: msg('site.explore'),
					items: [
						{ icon: 'tabler:rss', text: msg('site.atomFeed'), url: '/atom.xml' },
						{ icon: 'tabler:crown', text: msg('common.membership'), url: '/membership' },
					],
				},
			],
		},
		license: {
			abbr: 'CC BY-NC-SA 4.0',
			name: msg('site.attributionNoncommercialSharealike'),
			url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans',
		},
		since: '',
		timeZone: '',
		adminUrl: '',
		ogImage: '',
		outdatedDays: 365,
		birthYear: 0,
		blogLog: [],
		categories: [],
		redirects: [],
		scripts: [],
		liveDesk: { enable: false, showWindowTitle: false },
		ownerStatus: { fn: '' },
		i18n: { languages: [] },
		comments: { showAgent: true, imageHosts: [] },
	}
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = LIMITS.text): string | undefined {
	return typeof value === 'string' && value.trim().length <= max ? value.trim() : undefined
}

export function isSafeLink(url: string) {
	return SITE_PATH.test(url) || HTTP_URL.test(url) || MAILTO.test(url)
}

/** 图片、字体等资源：站内路径或 https；会拼进 CSS，引号、尖括号、括号、反斜杠一律不收 */
function asset(value: unknown): string | undefined {
	const url = text(value, 500)
	return url && !/["'<>()\\]/.test(url) && (SITE_PATH.test(url) || HTTPS_URL.test(url)) ? url : undefined
}

function navItem(value: unknown): NavItem | undefined {
	if (!isObject(value))
		return undefined
	const icon = text(value.icon, 60)
	const label = text(value.text, 60)
	const url = text(value.url, 500)
	if (!icon || !ICON.test(icon) || !label || !url || !isSafeLink(url))
		return undefined
	return { icon, text: label, url }
}

/** 把一个列表逐项净化：不是数组就整项作废，个别项不合格就丢掉该项 */
function list<T>(value: unknown, max: number, item: (v: unknown) => T | undefined, field: string, warnings: string[]): T[] | undefined {
	if (!Array.isArray(value)) {
		warnings.push(`${field} 应是数组，已用默认值`)
		return undefined
	}
	const items = value.slice(0, max).map(item)
	const kept = items.filter((v): v is T => v !== undefined)
	if (kept.length < items.length)
		warnings.push(`${field} 有 ${items.length - kept.length} 项格式不对，已丢掉`)
	if (value.length > max)
		warnings.push(`${field} 最多 ${max} 项，多出的已丢掉`)
	return kept
}

/** 去掉末尾的斜杠。用循环：`/\/+$/` 遇到一长串斜杠是平方级耗时，跳转中间件对每个请求都跑 */
function normalizePath(path: string) {
	let end = path.length
	while (end > 1 && path[end - 1] === '/')
		end--
	return path.slice(0, end)
}

/** 有这一项才处理：解析得出就写进 `target[key]`，否则记一条警告、保留默认值 */
function apply<O, K extends keyof O>(field: string, value: unknown, parse: (v: unknown) => O[K] | undefined, target: O, key: K, warnings: string[]) {
	if (value === undefined)
		return
	const parsed = parse(value)
	if (parsed === undefined)
		warnings.push(`${field} 格式不对，已用默认值`)
	else
		target[key] = parsed
}

function titleFontOf(value: unknown): ThemeConfig['header']['titleFont'] | undefined {
	if (value === null)
		return null
	const family = isObject(value) ? text(value.family, 40) : undefined
	const url = isObject(value) ? asset(value.url) : undefined
	return family && FONT_FAMILY.test(family) && url ? { family, url } : undefined
}

function navGroupOf(value: unknown, warnings: string[]): Nav[number] | undefined {
	const title = isObject(value) ? text(value.title, 40) : undefined
	if (!isObject(value) || !title)
		return undefined
	const items = list(value.items, LIMITS.nav, navItem, `footer.nav「${title}」`, warnings)
	return items ? { title, items } : undefined
}

function licenseOf(value: unknown): ThemeConfig['license'] | undefined {
	if (!isObject(value))
		return undefined
	const abbr = text(value.abbr, 40)
	const name = text(value.name, 100)
	const url = text(value.url, 500)
	return abbr && name && url && HTTP_URL.test(url) ? { abbr, name, url } : undefined
}

function categoryOf(value: unknown): ThemeConfig['categories'][number] | undefined {
	const name = isObject(value) ? text(value.name, 40) : undefined
	if (!isObject(value) || !name)
		return undefined
	const icon = text(value.icon, 60)
	const color = text(value.color, 9)
	const type = text(value.type, 20)
	if ((value.icon !== undefined && !(icon && ICON.test(icon))) || (value.color !== undefined && !(color && COLOR.test(color))))
		return undefined
	if (value.type !== undefined && !(type && type in blogConfig.article.types))
		return undefined
	return { name, ...(icon ? { icon } : {}), ...(color ? { color } : {}), ...(type ? { type } : {}) }
}

function redirectOf(value: unknown): ThemeConfig['redirects'][number] | undefined {
	const from = isObject(value) ? text(value.from, 500) : undefined
	const to = isObject(value) ? text(value.to, 500) : undefined
	if (!from || !to || !SITE_PATH.test(from) || !(SITE_PATH.test(to) || HTTP_URL.test(to)))
		return undefined
	if (RESERVED_REDIRECT_PREFIXES.some(prefix => from.startsWith(prefix)) || normalizePath(from) === '/')
		return undefined
	return { from: normalizePath(from), to }
}

/** 脚本上报数据的域名：`https://域名[:端口]`，可以用 `*.` 通配子域名；写进内容安全策略的 connect-src */
const CONNECT_ORIGIN = /^https:\/\/(?:\*\.)?[a-z\d-]+(?:\.[a-z\d-]+)+(?::\d{1,5})?$/i

function scriptOf(value: unknown): ThemeConfig['scripts'][number] | undefined {
	const src = isObject(value) ? text(value.src, 500) : undefined
	if (!isObject(value) || !src || !HTTPS_URL.test(src))
		return undefined
	const connect = Array.isArray(value.connect) ? value.connect.filter((v): v is string => typeof v === 'string' && CONNECT_ORIGIN.test(v)).slice(0, 5) : []
	return {
		src,
		...(value.defer === true ? { defer: true } : {}),
		...(value.async === true ? { async: true } : {}),
		...(connect.length ? { connect } : {}),
	}
}

/** 评论图片的地址前缀：https、不带用户名密码与查询参数，规范成以 `/` 结尾 */
function imagePrefixOf(value: unknown): string | undefined {
	const url = text(value, 300)
	if (!url || !HTTPS_URL.test(url))
		return undefined
	try {
		const parsed = new URL(url)
		if (parsed.username || parsed.password || parsed.search || parsed.hash)
			return undefined
		return parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`
	}
	catch {
		return undefined
	}
}

/** 净化原始配置：缺的、格式不对的项都退回默认值 */
export function themeConfigFrom(raw: unknown): { config: ThemeConfig, warnings: string[] } {
	const config = defaultThemeConfig()
	const warnings: string[] = []
	if (raw === null || raw === undefined)
		return { config, warnings }
	if (!isObject(raw))
		return { config, warnings: ['主题配置应是一个 JSON 对象，已全部用默认值'] }

	apply('subtitle', raw.subtitle, v => text(v), config, 'subtitle', warnings)

	if (raw.header !== undefined && !isObject(raw.header))
		warnings.push('header 格式不对，已用默认值')
	if (isObject(raw.header)) {
		const header = raw.header
		apply('header.logo', header.logo, v => v === '' ? '' : asset(v), config.header, 'logo', warnings)
		apply('header.showTitle', header.showTitle, v => typeof v === 'boolean' ? v : undefined, config.header, 'showTitle', warnings)
		if (header.emojiTail !== undefined)
			config.header.emojiTail = list(header.emojiTail, LIMITS.emoji, v => text(v, 16) || undefined, 'header.emojiTail', warnings) ?? config.header.emojiTail
		apply('header.titleFont', header.titleFont, titleFontOf, config.header, 'titleFont', warnings)
	}

	if (raw.footer !== undefined && !isObject(raw.footer))
		warnings.push('footer 格式不对，已用默认值')
	if (isObject(raw.footer)) {
		const footer = raw.footer
		apply('footer.copyright', footer.copyright, v => text(v), config.footer, 'copyright', warnings)
		if (footer.iconNav !== undefined)
			config.footer.iconNav = list(footer.iconNav, LIMITS.nav, navItem, 'footer.iconNav', warnings) ?? config.footer.iconNav
		if (footer.nav !== undefined)
			config.footer.nav = list(footer.nav, LIMITS.navGroups, v => navGroupOf(v, warnings), 'footer.nav', warnings) ?? config.footer.nav
	}

	if (raw.nav !== undefined)
		config.nav = list(raw.nav, LIMITS.sidebarNav, navItem, 'nav', warnings) ?? config.nav
	apply('license', raw.license, licenseOf, config, 'license', warnings)
	apply('since', raw.since, v => v === '' || (typeof v === 'string' && DATE.test(v)) ? v as string : undefined, config, 'since', warnings)
	apply('timeZone', raw.timeZone, v => v === '' || isValidTimeZone(v) ? v as string : undefined, config, 'timeZone', warnings)
	apply('adminUrl', raw.adminUrl, v => v === '' || (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v) && v.length <= 300) ? v as string : undefined, config, 'adminUrl', warnings)
	apply('ogImage', raw.ogImage, v => v === '' ? '' : asset(v), config, 'ogImage', warnings)
	apply('outdatedDays', raw.outdatedDays, v => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3650 ? v as number : undefined, config, 'outdatedDays', warnings)
	apply('birthYear', raw.birthYear, v => Number.isInteger(v) && (v === 0 || ((v as number) > 1900 && (v as number) < 2100)) ? v as number : undefined, config, 'birthYear', warnings)

	if (raw.blogLog !== undefined) {
		config.blogLog = list(raw.blogLog, LIMITS.blogLog, (v) => {
			const label = isObject(v) ? text(v.label, 40) : undefined
			const value = isObject(v) ? text(v.value) : undefined
			return label && value ? { label, value } : undefined
		}, 'blogLog', warnings) ?? config.blogLog
	}
	if (raw.categories !== undefined)
		config.categories = list(raw.categories, LIMITS.categories, categoryOf, 'categories', warnings) ?? config.categories
	if (raw.redirects !== undefined)
		config.redirects = list(raw.redirects, LIMITS.redirects, redirectOf, 'redirects', warnings) ?? config.redirects
	if (raw.scripts !== undefined)
		config.scripts = list(raw.scripts, LIMITS.scripts, scriptOf, 'scripts', warnings) ?? config.scripts

	if (isObject(raw.liveDesk)) {
		apply('liveDesk.enable', raw.liveDesk.enable, v => typeof v === 'boolean' ? v : undefined, config.liveDesk, 'enable', warnings)
		apply('liveDesk.showWindowTitle', raw.liveDesk.showWindowTitle, v => typeof v === 'boolean' ? v : undefined, config.liveDesk, 'showWindowTitle', warnings)
	}
	if (isObject(raw.ownerStatus))
		apply('ownerStatus.fn', raw.ownerStatus.fn, v => v === '' || (typeof v === 'string' && /^[\w-]{1,40}\/[\w-]{1,40}$/.test(v)) ? v as string : undefined, config.ownerStatus, 'fn', warnings)

	if (isObject(raw.i18n) && raw.i18n.languages !== undefined) {
		const languages = enabledLangsOf(raw.i18n.languages)
		if (!Array.isArray(raw.i18n.languages) || languages.length < raw.i18n.languages.length)
			warnings.push(`i18n.languages 只认 ${CANDIDATE_LANGS.join(' ')}，其余已忽略`)
		config.i18n.languages = languages
	}

	if (raw.comments !== undefined && !isObject(raw.comments))
		warnings.push('comments 格式不对，已用默认值')
	if (isObject(raw.comments)) {
		apply('comments.showAgent', raw.comments.showAgent, v => typeof v === 'boolean' ? v : undefined, config.comments, 'showAgent', warnings)
		if (raw.comments.imageHosts !== undefined)
			config.comments.imageHosts = list(raw.comments.imageHosts, 5, imagePrefixOf, 'comments.imageHosts', warnings) ?? config.comments.imageHosts
	}

	return { config, warnings }
}

/** 按请求路径找跳转目标。路径先解码、去掉末尾斜杠再比，查不到返回 undefined */
export function redirectTargetOf(redirects: ThemeConfig['redirects'], pathname: string) {
	// 旧链接不会这么长，超长的不查
	if (pathname.length > 2048)
		return undefined
	let path: string
	try {
		path = normalizePath(decodeURIComponent(pathname))
	}
	catch {
		return undefined
	}
	return redirects.find(r => r.from === path || safelyDecodeUriComponent(r.from) === path)?.to
}

/** 页脚版权文字里的占位符 */
export function footerCopyrightOf(template: string, author: string, year: number) {
	return template.replaceAll('{year}', String(year)).replaceAll('{author}', author)
}

/** ofetch 的错误：`status` 与解析好的响应体（core 的错误体是 `{ error: { code } }`）；连不上时没有 status */
function fetchFailureOf(error: unknown) {
	const e = error as { status?: number, statusCode?: number, data?: { error?: { code?: unknown } } } | undefined
	return { status: Number(e?.status ?? e?.statusCode) || 0, code: String(e?.data?.error?.code ?? '') }
}

/** 按顺序找的片段名：自己的在前，其次兼容 Yohaku、Shiro 的（`theme/yohaku`、`theme/shiro`） */
export const THEME_CANDIDATES = [THEME_NAME, 'yohaku', 'shiro'] as const

const isMissing = (failure: { status: number, code: string }) => failure.code === 'SNIPPET_NOT_FOUND' || failure.status === 404
const isPrivate = (failure: { status: number, code: string }) => failure.code === 'SNIPPET_PRIVATE' || failure.status === 403
const privateWarning = (name: string) => `主题配置片段 theme/${name} 是私有的，读不到；在 admin 里把它设为公开`

/**
 * 语言覆盖片段（`theme/<名字>.<语言>`）合进基础片段，语义照 core（es-toolkit 的 merge）：
 * 对象逐键深合并，数组按下标逐项合并（覆盖片段没法缩短或删项），其余以覆盖的为准。两个都不改
 */
export function mergeThemeOverlay(base: unknown, overlay: unknown): unknown {
	if (Array.isArray(base) && Array.isArray(overlay))
		return Array.from({ length: Math.max(base.length, overlay.length) }, (_, i) => i < overlay.length ? mergeThemeOverlay(base[i], overlay[i]) : base[i])
	if (isObject(base) && isObject(overlay)) {
		const merged: Json = { ...base }
		for (const [key, value] of Object.entries(overlay)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype')
				continue
			merged[key] = key in base ? mergeThemeOverlay(base[key], value) : value
		}
		return merged
	}
	return overlay === undefined ? base : overlay
}

/** Shiro、Yohaku 的配置是 `{ config, footer }`，页脚链接在 `footer.linkSections` */
export function isOfficialThemeShape(raw: unknown): raw is Json & { config: Json, footer: Json & { linkSections: unknown[] } } {
	return isObject(raw) && isObject(raw.config) && isObject(raw.footer) && Array.isArray(raw.footer.linkSections)
}

/**
 * Shiro / Yohaku 的配置 → 本主题的原始配置，只认几项有对应、又安全的：页脚链接分组、首页的一句话简介（副标题）、
 * 页脚的年份（`{{now}}` 换成今年）与备案号。自定义 CSS/JS、`module.*`、站点图标一概不认。结果照旧过 `themeConfigFrom`
 */
export function fromOfficialTheme(raw: Json & { config: Json, footer: Json & { linkSections: unknown[] } }): Json {
	const out: Json = {}
	const nav = raw.footer.linkSections.flatMap((section) => {
		if (!isObject(section) || !Array.isArray(section.links))
			return []
		const items = section.links.flatMap(link => isObject(link) && typeof link.name === 'string' && typeof link.href === 'string'
			? [{ icon: 'tabler:link', text: link.name, url: link.href }]
			: [])
		return typeof section.name === 'string' && items.length ? [{ title: section.name, items }] : []
	})
	const other = isObject(raw.footer.otherInfo) ? raw.footer.otherInfo : {}
	const icp = isObject(other.icp) && typeof other.icp.text === 'string' && typeof other.icp.link === 'string'
		? { icon: 'tabler:certificate', text: other.icp.text, url: other.icp.link }
		: undefined
	if (icp)
		nav.push({ title: msg('common.info'), items: [icp] })
	if (nav.length)
		out.footer = { nav }
	if (typeof other.date === 'string' && other.date.trim())
		out.footer = { ...(out.footer as Json | undefined), copyright: `© ${other.date.replaceAll('{{now}}', '{year}')} {author}` }
	const hero = isObject(raw.config.hero) ? raw.config.hero : {}
	if (typeof hero.description === 'string')
		out.subtitle = hero.description
	return out
}

/** 读主题配置的两种途径，由服务端给（便于单测） */
export interface ThemeSources {
	/** `GET /aggregate?theme=mx-clarity|yohaku|shiro&lang=` 的 `theme`（core 按顺序取第一个有的，合好语言覆盖）；没有可见日记时 `/aggregate` 404，抛出 */
	aggregate: () => Promise<unknown>
	/** `GET /s/theme/<名字>`，原样返回存进去的 JSON；没有时抛 404，私有时抛 403 */
	snippet: (name: string) => Promise<unknown>
}

/**
 * 读主题配置：先走 `/aggregate?theme=`（兼容 Yohaku、Shiro 的片段名，带语言覆盖），它失败时退回逐个读 `/s/theme/<名字>`，
 * 再自己合 `.<语言>` 的覆盖片段。都没有是正常情况（站长还没配），返回默认值；片段设成私有的给出提示。
 * core 不可用等其它错误照抛，交给缓存层保留上一次的值
 */
export async function loadThemeConfig(sources: ThemeSources, lang?: string) {
	const warnings: string[] = []
	let raw: unknown
	let viaAggregate = true
	try {
		raw = await sources.aggregate()
	}
	catch {
		viaAggregate = false
	}
	if (viaAggregate && (raw === undefined || raw === null)) {
		// 聚合接口不告诉我们为什么没有：只为认出「设成了私有」再问一次自己的片段
		await sources.snippet(THEME_NAME).then(() => undefined, (error) => {
			if (isPrivate(fetchFailureOf(error)))
				warnings.push(privateWarning(THEME_NAME))
		})
		return { config: defaultThemeConfig(), warnings }
	}
	if (!viaAggregate) {
		let found: string | undefined
		for (const name of THEME_CANDIDATES) {
			try {
				raw = await sources.snippet(name)
				found = name
				break
			}
			catch (error) {
				const failure = fetchFailureOf(error)
				if (isPrivate(failure))
					warnings.push(privateWarning(name))
				else if (!isMissing(failure))
					throw error
			}
		}
		if (!found)
			return { config: defaultThemeConfig(), warnings }
		if (lang) {
			const overlay = await sources.snippet(`${found}.${lang}`).catch(() => undefined)
			if (overlay !== undefined)
				raw = mergeThemeOverlay(raw, overlay)
		}
	}
	if (isOfficialThemeShape(raw)) {
		warnings.push('按 Yohaku / Shiro 的配置格式读取：只认页脚链接、简介、年份与备案号，其余项请照本主题的格式写到 theme/mx-clarity')
		raw = fromOfficialTheme(raw)
	}
	const result = themeConfigFrom(raw)
	return { config: result.config, warnings: [...warnings, ...result.warnings] }
}
