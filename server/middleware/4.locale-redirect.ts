import { LANG_COOKIE, localeRedirectOf, routeLangOf } from '~~/shared/utils/lang'

/**
 * 按浏览器语言自动跳转（与 Yohaku 一样）：只管页面请求（GET、要 HTML、不是接口与静态文件）。
 * - 进前缀版（开了的语言）时把 cookie `mx-lang` 记成那个语言，之后不带前缀来访就按它跳；
 * - 没有 cookie 时按 `Accept-Language` 在「中文 + 开了的语言」里挑，首选不是中文就 302 到那个语言的前缀版；
 * - 文章、日记详情，看原文、爬虫、读者选过中文（语言切换里写的 `zh`）不跳，见 `localeRedirectOf`
 */
export default defineEventHandler(async (event) => {
	if (event.method !== 'GET' && event.method !== 'HEAD')
		return
	const url = getRequestURL(event)
	const path = url.pathname
	// `/__nuxt_error` 等内部地址（渲染错误页时 Nitro 自己再请求一次）也不管
	if (/^\/(?:api|_nuxt|_ipx)(?:\/|$)|^\/__/.test(path) || /\.[\w-]+$/.test(path))
		return
	if (!(getHeader(event, 'accept') ?? '').includes('text/html'))
		return
	const enabled = await enabledContentLangs().catch((): string[] => [])
	if (!enabled.length)
		return
	const prefix = routeLangOf(path.split('/')[1])
	const cookie = getCookie(event, LANG_COOKIE)
	if (prefix) {
		if (enabled.includes(prefix) && cookie !== prefix)
			setCookie(event, LANG_COOKIE, prefix, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
		return
	}
	// 同一个无前缀地址对不同的语言偏好回不同的结果
	appendResponseHeader(event, 'vary', 'Accept-Language, Cookie')
	const target = localeRedirectOf({
		path,
		search: url.search,
		cookie,
		acceptLanguage: getHeader(event, 'accept-language'),
		userAgent: getHeader(event, 'user-agent'),
		enabled,
	})
	if (target)
		return sendRedirect(event, target, 302)
})
