import { toZonedTemporal } from '~~/shared/utils/time'
/**
 * 订阅源 `/atom.xml`，主题自己生成（core 的 /feed 对 Lexical 文章只给英文占位）。纯模块。
 *
 * 每条是封面 + 全文（`html`，由 `feed-html.ts` 按订阅源的白名单生成）+ 「在网站上阅读」；
 * 付费文章、没有全文的条目只放摘要。
 * `public/assets/atom.xsl` 直接打开订阅源时只显示摘要，不把 `<content>` 当 HTML 插进页面。
 */
import { homepage, name, version } from '../../../package.json'
import { safeUrl } from './adapter'

export const FEED_LIMIT = 20

export interface FeedSite {
	title: string
	description: string
	/** mx 的 `url.webUrl`，条目的绝对地址都基于它 */
	url: string
	author: { name: string, avatar?: string }
	icon?: string
	language: string
	/** 站点时区，版权年份按它算；不给就按 UTC */
	timeZone?: string
}

export interface FeedEntry {
	title: string
	/** 站内路径，如 `/posts/tech/slug` */
	path: string
	summary?: string
	image?: string
	category?: string
	published: string
	updated?: string
	/** 全文 HTML（已按订阅源的白名单生成）；不给就只放摘要 */
	html?: string
	/** 付费文章：只放摘要，并说明全文在原站 */
	premium?: boolean
}

/** XML 1.0 不允许的控制字符：除制表、换行、回车以外的 U+0000–U+001F */
function isInvalidXmlChar(char: string) {
	const code = char.charCodeAt(0)
	return code < 32 && code !== 9 && code !== 10 && code !== 13
}

export function escapeXml(value: string) {
	const text = [...value].filter(char => !isInvalidXmlChar(char)).join('')
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

function isoOf(date: string | undefined) {
	const time = date ? Date.parse(date) : Number.NaN
	return Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

function absolute(path: string, base: string) {
	try {
		return new URL(path, base).href
	}
	catch {
		return undefined
	}
}

/** 条目正文的 HTML：先按 HTML 转义拼出来（全文已由 feed-html 转义好），写进 XML 时再整体转义一次 */
function entryHtml(entry: FeedEntry, link: string) {
	const image = safeUrl(entry.image)
	const body = entry.html && !entry.premium
		? entry.html
		: entry.summary && `<p>${escapeXml(entry.summary)}</p>`
	return [
		image && `<img src="${escapeXml(image)}" alt="${escapeXml(entry.title)}" />`,
		body,
		entry.premium && '<p>本文为付费文章，全文请到原站阅读。</p>',
		`<p><a class="view-full" href="${escapeXml(link)}" rel="noopener">${entry.html && !entry.premium ? '在网站上阅读' : '点击查看全文'}</a></p>`,
	].filter(Boolean).join('\n')
}

export function buildAtomFeed(site: FeedSite, entries: FeedEntry[], selfPath = '/atom.xml') {
	const base = safeUrl(site.url) ?? 'http://localhost/'
	const selfUrl = absolute(selfPath, base)!
	const items = [...entries]
		.filter(entry => isoOf(entry.published))
		.sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
		.slice(0, FEED_LIMIT)
	const updated = items.map(entry => isoOf(entry.updated) ?? isoOf(entry.published)!).sort().at(-1) ?? new Date(0).toISOString()
	const tag = (name: string, value: string | undefined) => value ? `<${name}>${escapeXml(value)}</${name}>` : ''

	const body = items.flatMap((entry) => {
		const link = absolute(entry.path, base)
		if (!link)
			return []
		return [[
			'<entry>',
			tag('id', link),
			tag('title', entry.title),
			`<link href="${escapeXml(link)}" />`,
			tag('published', isoOf(entry.published)),
			tag('updated', isoOf(entry.updated) ?? isoOf(entry.published)),
			tag('summary', entry.summary),
			entry.category ? `<category term="${escapeXml(entry.category)}" />` : '',
			`<content type="html">${escapeXml(entryHtml(entry, link))}</content>`,
			`<author>${tag('name', site.author.name)}</author>`,
			'</entry>',
		].filter(Boolean).join('')]
	})

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<?xml-stylesheet type="text/xsl" href="/assets/atom.xsl"?>',
		`<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeXml(site.language)}">`,
		tag('id', base),
		tag('title', site.title),
		tag('subtitle', site.description),
		`<link href="${escapeXml(selfUrl)}" rel="self" />`,
		`<link href="${escapeXml(base)}" rel="alternate" />`,
		tag('updated', updated),
		`<author>${tag('name', site.author.name)}</author>`,
		tag('icon', safeUrl(site.icon)),
		tag('logo', safeUrl(site.author.avatar)),
		tag('rights', `© ${toZonedTemporal(updated, site.timeZone ?? 'UTC').year} ${site.author.name}`),
		`<generator uri="${escapeXml(homepage)}" version="${escapeXml(version)}">${escapeXml(name)}</generator>`,
		...body,
		'</feed>',
	].filter(Boolean).join('\n')
}
