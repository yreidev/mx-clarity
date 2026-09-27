/** 主题配置（缓存见 server/utils/mx.ts 的 getCachedThemeConfig）；读不到时给默认值，页面照常渲染。`timeZone` 是生效的站点时区 */
export default defineEventHandler(async event => getThemeConfigWithTimeZone(await requestLangOf(event)))
