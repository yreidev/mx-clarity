import type { UiLang } from './i18n'
import { toArray } from '@vueuse/core'
import { escapeRegExp } from 'es-toolkit/string'
import { localeOf } from './i18n'

// @keep-sorted
const promptLanguageMap: Record<string, string> = {
	'#': 'sh',
	'$': 'sh',
	'CMD': 'bat',
	'PS': 'powershell',
}

/** 大数缩写：中文「1.20万」，其余按 Intl 的紧凑写法（英文「12K」、日文「1.2万」、韩文「1.2만」）；一万以下原样 */
export function formatNumber(num?: number, lang: UiLang = 'zh') {
	if (typeof num !== 'number')
		return ''
	if (lang !== 'zh')
		return num >= 1e4 ? new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(num) : num.toString()
	const intervals = [
		{ label: '万亿', threshold: 1e12 },
		{ label: '亿', threshold: 1e8 },
		{ label: '万', threshold: 1e4 },
	]
	for (const interval of intervals) {
		if (num >= interval.threshold)
			return `${(num / interval.threshold).toFixed(2)}${interval.label}`
	}
	return num.toString()
}

interface FormatBytesOptions {
	decimals?: number
	binary?: boolean
	unitSeparator?: string
}

export function formatBytes(bytes: number, options: FormatBytesOptions = {}) {
	const {
		decimals = 2,
		binary = true,
		unitSeparator = ' ',
	} = options

	if (bytes === 0)
		return `0${unitSeparator}Bytes`

	const base = binary ? 1024 : 1000
	const units = binary
		? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']
		: ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

	const i = Math.floor(Math.log(bytes) / Math.log(base))
	const value = Number.parseFloat((bytes / base ** i).toFixed(decimals))

	return `${value}${unitSeparator}${units[i]}`
}

export function getPromptLanguage(prompt: string | boolean) {
	if (typeof prompt === 'boolean')
		return 'text'
	for (const promptPrefix in promptLanguageMap) {
		if (prompt.startsWith(promptPrefix))
			return promptLanguageMap[promptPrefix] ?? 'text'
	}
	return 'text'
}

export function joinWith(strings: (string | undefined)[], separator = '\n') {
	return strings.filter(Boolean).join(separator)
}

/**
 * 按命中词把文字切成片段，模板逐段渲染、命中的套 `<mark>`。
 * 不拼 HTML 字符串：搜索结果来自 core，片段是正文截出来的，一律当纯文本
 */
export function splitHighlight(text: string, words: string | string[] | undefined) {
	const terms = [...new Set(toArray(words)
		.filter((t): t is string => !!t?.trim())
		.map(t => t.toLowerCase()))]
	if (!terms.length)
		return [{ text, hit: false }]
	// 全是转义过的字面量的「或」，没有回溯问题；长的在前，「数据库」不会被「数据」截断
	const alternatives = [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp)
	const pattern = new RegExp(`(${alternatives.join('|')})`, 'gi')
	return text.split(pattern)
		.filter(Boolean)
		.map(part => ({ text: part, hit: terms.includes(part.toLowerCase()) }))
}

export function removeHtmlTags(str?: string) {
	if (typeof str !== 'string')
		return ''
	return str.replace(/<[^>]+(>|$)/g, '')
}
