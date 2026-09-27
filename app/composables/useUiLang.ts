import type { MessageParams } from '~~/shared/utils/i18n'

/** 当前的界面语言：无前缀的地址是中文，`/<语言>/...` 是英文 */
export function useUiLang() {
	const lang = useRouteLang()
	return computed(() => uiLangOf(lang.value))
}

/** 组件里取界面文字：`t('中文原文', { 参数 })`，在模板里调用时跟着界面语言变 */
export function useT() {
	const lang = useUiLang()
	return (source: string, params?: MessageParams) => translate(lang.value, source, params)
}

/** 格式化日期、数字用的 locale（`zh-CN` / `en-US`） */
export function useUiLocale() {
	const lang = useUiLang()
	return computed(() => localeOf(lang.value))
}
