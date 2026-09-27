/**
 * 界面文字的多语言（与 Yohaku 同一种做法）：源码里写英文 id（`comment.send`），文字在 `shared/locales/<语言>/<命名空间>.json`。
 * 界面语言跟着地址前缀：无前缀是中文，`/en`、`/ja`、`/ko` 各是英文、日文、韩文界面，其余开了的内容语言（法、德……）用英文界面。
 * 某种语言缺的一句依次退回英文、中文；都没有的原样返回（服务端的报错、站长写的文字直接显示）。
 *
 * 服务端发给浏览器的报错与状态文案（`msg()`）照旧是中文，浏览器显示时经 `t()` 按中文反查到 id 再取当前语言，
 * 接口与日志都不用改。纯函数，服务端与浏览器共用
 */
import en from '../locales/en'
import ja from '../locales/ja'
import ko from '../locales/ko'
import zh from '../locales/zh'

export type UiLang = 'zh' | 'en' | 'ja' | 'ko'

/** 有界面文字的语言（其余前缀用英文界面） */
export const UI_LANGS: readonly UiLang[] = ['zh', 'en', 'ja', 'ko']

/** 一句文字：普通的一句，或按数量分单复数（参数 `n`；中、日、韩只用 `other`） */
export type Message = string | { one: string, other: string }

export type MessageParams = Record<string, string | number>

type Namespaces = Record<string, Record<string, Message>>

/** `{ comment: { send: … } }` → `{ 'comment.send': … }` */
function flatten(namespaces: Namespaces) {
	const out: Record<string, Message> = {}
	for (const [ns, table] of Object.entries(namespaces)) {
		for (const [id, message] of Object.entries(table))
			out[`${ns}.${id}`] = message
	}
	return out
}

const CATALOGS: Record<UiLang, Record<string, Message>> = {
	zh: flatten(zh as Namespaces),
	en: flatten(en as Namespaces),
	ja: flatten(ja as Namespaces),
	ko: flatten(ko as Namespaces),
}

/** 中文 → id：服务端发来的中文文案、站长用了主题默认值的导航名，按它找到 id 再取当前语言。同一句中文先登记的优先 */
const ID_OF_ZH = new Map<string, string>()
for (const [id, message] of Object.entries(CATALOGS.zh)) {
	const text = typeof message === 'string' ? message : message.other
	if (!ID_OF_ZH.has(text))
		ID_OF_ZH.set(text, id)
}

/** 地址前缀里的语言 → 界面语言：没有前缀是中文，日文、韩文有自己的界面，其余一律英文 */
export function uiLangOf(routeLang: string | undefined): UiLang {
	if (!routeLang)
		return 'zh'
	return routeLang === 'ja' || routeLang === 'ko' ? routeLang : 'en'
}

const LOCALES: Record<UiLang, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' }

/** 界面语言 → 格式化日期、数字用的 locale */
export function localeOf(lang: UiLang) {
	return LOCALES[lang]
}

/** 界面语言 → `<html lang>` */
export function htmlLangOf(lang: UiLang) {
	return lang === 'zh' ? 'zh-CN' : lang
}

const plurals = new Map<UiLang, Intl.PluralRules>()
function pluralOf(lang: UiLang, n: number) {
	let rules = plurals.get(lang)
	if (!rules) {
		rules = new Intl.PluralRules(LOCALES[lang])
		plurals.set(lang, rules)
	}
	return rules.select(n)
}

function interpolate(text: string, params?: MessageParams) {
	return params ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole)) : text
}

/** `key` 是 id，或者一句中文（反查成 id）；返回这一语言的那一句，缺的依次退回英文、中文 */
function lookup(lang: UiLang, key: string): Message | undefined {
	const id = Object.hasOwn(CATALOGS.zh, key) ? key : ID_OF_ZH.get(key)
	if (!id)
		return undefined
	for (const candidate of [lang, 'en', 'zh'] as const) {
		if (Object.hasOwn(CATALOGS[candidate], id))
			return CATALOGS[candidate][id]
	}
	return undefined
}

/**
 * 取一句界面文字：`key` 是 id（`comment.send`）或一句中文；`{参数}` 换成 `params` 里的值，按 `params.n` 选单复数。
 * 查不到的原样返回（服务端的报错、站长写的导航名直接显示）
 */
export function translate(lang: UiLang | undefined, key: string, params?: MessageParams) {
	const ui = lang ?? 'zh'
	const message = lookup(ui, key) ?? key
	if (typeof message === 'string')
		return interpolate(message, params)
	return interpolate(pluralOf(ui, Number(params?.n ?? 0)) === 'one' ? message.one : message.other, params)
}

/**
 * 服务端要发给浏览器、在那里显示的文案（接口的报错、状态说明），以及主题的默认导航名这类数据里的文字：
 * 按 id 取中文原样返回，页面显示时再过 `t()`（按中文反查回 id）。单测按它收集 id
 */
export function msg(id: string) {
	const message = CATALOGS.zh[id]
	if (message === undefined)
		return id
	return typeof message === 'string' ? message : message.other
}

/**
 * 访客自己填的名字（评论昵称）：只有没填时的占位「匿名」（`msg('common.anonymous')`）按界面语言显示，其余原样。
 * 不能交给 `translate`：它把 id 与中文原句都当界面文字去查，昵称填成 `common.owner` 就显示成「站长」
 */
export function visitorNameText(lang: UiLang | undefined, name: string) {
	return name === msg('common.anonymous') ? translate(lang, 'common.anonymous') : name
}

/** 这一语言的表里有没有这个 id（单测与开发时的检查用） */
export function hasMessage(lang: UiLang, id: string) {
	return Object.hasOwn(CATALOGS[lang], id)
}
