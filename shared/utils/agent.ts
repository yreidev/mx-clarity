import { msg } from './i18n'
/**
 * 评论下显示的「浏览器 · 系统」。只认常见的浏览器与系统，只到大版本，不含设备型号；
 * 认不出的（服务端请求的 `node`、`curl` 之类）返回空。纯函数。
 */

const AGENT_MAX = 512

/** 按顺序匹配：套了 Chrome 内核的国产浏览器、App 内置浏览器要排在 Chrome 前面 */
const BROWSERS: [RegExp, (m: RegExpMatchArray) => string][] = [
	[/MicroMessenger\//, () => msg('comment.wechat')],
	[/\bQQ\/\d/, () => 'QQ'],
	[/M?QQBrowser\//, () => msg('comment.qqBrowser')],
	[/UCBrowser\//, () => msg('comment.ucBrowser')],
	[/Quark\//, () => msg('comment.quark')],
	[/HuaweiBrowser\//, () => msg('comment.huaweiBrowser')],
	[/MiuiBrowser\//, () => msg('comment.xiaomiBrowser')],
	[/SamsungBrowser\/(\d+)/, m => `Samsung Internet ${m[1]}`],
	[/EdgA?\/(\d+)|EdgiOS\/(\d+)/, m => `Edge ${m[1] ?? m[2]}`],
	[/OPR\/(\d+)|OPT\/(\d+)/, m => `Opera ${m[1] ?? m[2]}`],
	[/Firefox\/(\d+)|FxiOS\/(\d+)/, m => `Firefox ${m[1] ?? m[2]}`],
	[/CriOS\/(\d+)/, m => `Chrome ${m[1]}`],
	[/Chrome\/(\d+)/, m => `Chrome ${m[1]}`],
	[/Version\/(\d+)(?:\.\d+)*(?: Mobile\/\w+)? Safari\//, m => `Safari ${m[1]}`],
]

const WINDOWS: Record<string, string> = { '10.0': 'Windows', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' }

function systemOf(ua: string) {
	const windows = ua.match(/Windows NT (\d+\.\d+)/)
	if (windows)
		return WINDOWS[windows[1]!] ?? 'Windows'
	const ios = ua.match(/\b(iPhone|iPod|iPad)\b.*? OS (\d+)_/)
	if (ios)
		return `${ios[1] === 'iPad' ? 'iPadOS' : 'iOS'} ${ios[2]}`
	if (/HarmonyOS|OpenHarmony/.test(ua))
		return 'HarmonyOS'
	const android = ua.match(/Android (\d+)/)
	if (android)
		return `Android ${android[1]}`
	if (/Macintosh|Mac OS X/.test(ua))
		return 'macOS'
	if (/CrOS/.test(ua))
		return 'ChromeOS'
	if (/Linux/.test(ua))
		return 'Linux'
	return undefined
}

export function agentLabelOf(ua: unknown) {
	if (typeof ua !== 'string' || !ua || ua.length > AGENT_MAX)
		return undefined
	let browser: string | undefined
	for (const [pattern, label] of BROWSERS) {
		const matched = ua.match(pattern)
		if (matched) {
			browser = label(matched)
			break
		}
	}
	const label = [browser, systemOf(ua)].filter(Boolean).join(' · ')
	return label || undefined
}
