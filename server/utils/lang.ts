import type { H3Event } from 'h3'
import { contentLangOf, ORIGINAL_LANG } from '~~/shared/utils/lang'

/** 生效的内容语言：主题配置 `i18n.languages`（站点语言那一份，已按候选过滤）；读不到时是空的（多语言关闭） */
export async function enabledContentLangs() {
	return (await getThemeConfigWithTimeZone()).i18n.languages
}

/**
 * 这次请求的内容语言：`?lang=` 折成两字母后在生效的语言里才用，其余一律按站点语言（undefined）。
 * `allowOriginal` 时也认 `?lang=original`（看原文，core 的特殊值）
 */
export async function requestLangOf(event: H3Event, options: { allowOriginal?: boolean } = {}) {
	const value = getQuery(event).lang
	if (options.allowOriginal && value === ORIGINAL_LANG)
		return ORIGINAL_LANG
	return contentLangOf(value, await enabledContentLangs())
}
