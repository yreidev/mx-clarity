import { describe, expect, it } from 'vitest'
import { agentLabelOf } from '../../shared/utils/agent'

describe('评论下的「浏览器 · 系统」', () => {
	it('常见浏览器与系统只到大版本，不带设备型号', () => {
		const cases: [string, string][] = [
			['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'Chrome 140 · Windows'],
			['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54', 'Edge 140 · Windows'],
			['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Safari 17 · macOS'],
			['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari 17 · iOS 17'],
			['Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome 139 · iPadOS 16'],
			['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox 130 · Linux'],
			['Mozilla/5.0 (Linux; Android 14; 23078RKD5C Build/UKQ1.230804.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Mobile Safari/537.36 XWEB/1220133 MMWEBSDK/20240404 MMWEBID/1234 MicroMessenger/8.0.50.2701(0x28003237) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64', '微信 · Android 14'],
			['Mozilla/5.0 (Linux; Android 13; SM-S9180) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36', 'Samsung Internet 23 · Android 13'],
			['Mozilla/5.0 (Linux; Android 10; HarmonyOS; ALN-AL00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0.5.300 Mobile Safari/537.36', '华为浏览器 · HarmonyOS'],
			['Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36', 'Chrome 109 · Windows 7'],
		]
		for (const [ua, label] of cases)
			expect(agentLabelOf(ua), ua).toBe(label)
		// 不含设备型号
		expect(agentLabelOf(cases[6]![0])).not.toContain('23078RKD5C')
	})

	it('认不出的、服务端请求的、异常的都不显示', () => {
		for (const ua of ['node', 'curl/8.22.0', '', 'x'.repeat(600), undefined, 42])
			expect(agentLabelOf(ua), String(ua)).toBeUndefined()
	})
})
