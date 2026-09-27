import type { UiLang } from './i18n'
import { Temporal } from 'temporal-polyfill'
import blogConfig from '~~/blog.config'

/** 是不是运行环境认得的 IANA 时区名（`Asia/Shanghai`、`UTC`） */
export function isValidTimeZone(value: unknown): value is string {
	if (typeof value !== 'string' || !value || value.length > 64)
		return false
	try {
		// eslint-disable-next-line no-new -- 只用它校验时区名，认不得会抛 RangeError
		new Intl.DateTimeFormat('en', { timeZone: value })
		return true
	}
	catch {
		return false
	}
}

/**
 * 站点时区：主题配置里填的 ＞ 主题进程的时区（环境变量 `TZ`）＞ UTC。
 * 服务端算好随主题配置下发，页面在服务端与浏览器里用同一个时区，读者浏览器的时区不参与
 */
export function resolveTimeZone(configured: unknown, processZone: unknown) {
	if (isValidTimeZone(configured))
		return configured
	if (isValidTimeZone(processZone))
		return processZone
	return 'UTC'
}

export function isSameUnit(date1: string, date2: string, unit: Temporal.DateUnit | Temporal.TimeUnit, timeZone: string) {
	try {
		const p1 = toZonedTemporal(date1, timeZone).toPlainDateTime()
		const p2 = toZonedTemporal(date2, timeZone).toPlainDateTime()
		return p1.until(p2, {
			largestUnit: unit,
			smallestUnit: unit,
			roundingMode: 'trunc',
		}).blank
	}
	catch {
		return false
	}
}

/** 检查两个时间相对现在是否相差显著 */
export function isTimeDiffSignificant(
	date1?: string,
	date2?: string,
	/** 对于时间差的敏感程度，0~1 之间，1:不同则认为显著，>1:始终认为显著 */
	threshold = 0.6,
) {
	if (!date1 || !date2 || threshold <= 0)
		return false
	if (threshold > 1)
		return true
	try {
		const now = Temporal.Now.instant().epochMilliseconds
		const diff1 = now - epochOf(date1)
		const diff2 = now - epochOf(date2)
		return diff1 / diff2 < threshold || diff2 / diff1 < threshold
	}
	catch {
		return true
	}
}

/** 时长的单位：中文、日文紧挨着写（「3年2个月」「3年2か月」），英文、韩文用空格分开（「3 years 2 months」「3년 2개월」） */
const timeIntervals = [
	{ zh: '世纪', ja: '世紀', ko: '세기', en: ['century', 'centuries'], threshold: 60 * 60 * 24 * 365.2422 * 100 },
	{ zh: '年', ja: '年', ko: '년', en: ['year', 'years'], threshold: 60 * 60 * 24 * 365.2422 },
	{ zh: '个月', ja: 'か月', ko: '개월', en: ['month', 'months'], threshold: 60 * 60 * 24 * 30.44 },
	{ zh: '天', ja: '日', ko: '일', en: ['day', 'days'], threshold: 60 * 60 * 24 },
	{ zh: '小时', ja: '時間', ko: '시간', en: ['hour', 'hours'], threshold: 60 * 60 },
	{ zh: '分', ja: '分', ko: '분', en: ['minute', 'minutes'], threshold: 60 },
	{ zh: '秒', ja: '秒', ko: '초', en: ['second', 'seconds'], threshold: 1 },
] as const

const JUST_NOW: Record<UiLang, string> = { zh: '刚刚', en: 'just now', ja: 'たった今', ko: '방금' }

/** 从 `date`（站点时区的日期或日期时间）到站点时区的现在，过了多久，按界面语言写 */
export function timeElapse(date: string | Temporal.PlainDateTime, timeZone: string, maxDepth = 2, lang: UiLang = 'zh') {
	const parts: string[] = []
	let secRemained = Temporal.Now.plainDateTimeISO(timeZone).since(date, { largestUnit: 'second' }).seconds
	for (const interval of timeIntervals) {
		const count = Math.floor(secRemained / interval.threshold)
		if (count <= 0)
			continue
		if (lang === 'en')
			parts.push(`${count} ${interval.en[count === 1 ? 0 : 1]}`)
		else
			parts.push(`${count}${interval[lang]}`)
		secRemained -= count * interval.threshold
		if (--maxDepth <= 0)
			break
	}
	if (!parts.length)
		return JUST_NOW[lang]
	return parts.join(lang === 'en' || lang === 'ko' ? ' ' : '')
}

export function toInstantString(date: Temporal.ZonedDateTime) {
	return date.toInstant().toString()
}

/** 时刻的毫秒数；只有日期时间、没带时区的按 UTC 算（只用来比较时间差，差几小时无所谓） */
function epochOf(date: string) {
	try {
		return Temporal.Instant.from(date).epochMilliseconds
	}
	catch {
		try {
			return Temporal.ZonedDateTime.from(date).epochMilliseconds
		}
		catch {
			return Temporal.PlainDateTime.from(date).toZonedDateTime('UTC').epochMilliseconds
		}
	}
}

/**
 * 把 core 给的时间换到站点时区。带时区的（`…[Asia/Tokyo]`）换算过来；
 * 只有日期时间、没带时区的（主题配置里的 `since`）当成站点时区的时间
 */
export function toZonedTemporal(date: string, timeZone: string) {
	try {
		return Temporal.ZonedDateTime.from(date).withTimeZone(timeZone)
	}
	catch {
		try {
			return Temporal.Instant.from(date).toZonedDateTimeISO(timeZone)
		}
		catch {
			return Temporal.PlainDateTime.from(date).toZonedDateTime(timeZone)
		}
	}
}

export const dateTimeFormat = {
	date: {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	},
	monthDay: {
		month: '2-digit',
		day: '2-digit',
	},
	full: {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'long',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		timeZoneName: 'long',
	},
} satisfies Record<string, Intl.DateTimeFormatOptions>

export type dateTimeFormatOptions = keyof typeof dateTimeFormat | Intl.DateTimeFormatOptions

/** core 给的时间换到站点时区再格式化；`locale` 是界面语言的（`useUiLocale()`），不给是中文 */
export function toZonedLocaleString(date: string, timeZone: string, format: dateTimeFormatOptions = 'full', locale: string = blogConfig.language) {
	return toZdtLocaleString(toZonedTemporal(date, timeZone), format, locale)
}

/** 按 `date` 自带的时区（先用 `toZonedTemporal` 换到站点时区）格式化 */
export function toZdtLocaleString(date: Temporal.ZonedDateTime, format: dateTimeFormatOptions = 'full', locale: string = blogConfig.language) {
	// 显式传语言：服务端（容器里默认 en-US）与浏览器要格式化成同一串，否则水合不一致
	return date.toLocaleString(locale, typeof format === 'string' ? dateTimeFormat[format] : format)
}
