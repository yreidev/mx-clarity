/**
 * 站长「此刻」：播放进度推到此刻、图片换成签好名的转发地址、歌曲链接只认两家
 */
import { describe, expect, it } from 'vitest'
import { liveDeskFrom, mediaLinkOf } from '../../app/utils/mx/companion'
import { liveDeskImageUrlOf, proxiableImageUrl, signImageUrl, verifyImageUrl } from '../../server/utils/live-desk-image'

const NOW = Date.parse('2026-09-25T10:00:00.000Z')
function state(media: Record<string, unknown>, app: Record<string, unknown> = {}) {
	return {
		epoch: 'e1',
		revision: 1,
		projection: {
			availability: 'active',
			expiresAt: '2026-09-25T10:05:00.000Z',
			application: { displayName: 'VS Code', icon: { url: 'https://cdn.example.test/vscode.png' }, ...app },
			media: { kind: 'music', title: '一首歌', artist: '某人', ...media },
		},
	}
}

describe('播放进度', () => {
	it('在放：位置 + (此刻 − anchorAt) × 速率，夹在时长以内', () => {
		const desk = liveDeskFrom(state({ playback: { state: 'playing', durationMs: 200_000, positionMs: 10_000, anchorAt: '2026-09-25T09:59:55.000Z', rate: 1.5 } }), {}, NOW)
		expect(desk?.media).toMatchObject({ playing: true, positionMs: 17_500, durationMs: 200_000, rate: 1.5 })
		const over = liveDeskFrom(state({ playback: { state: 'playing', durationMs: 20_000, positionMs: 10_000, anchorAt: '2026-09-25T09:50:00.000Z', rate: 1 } }), {}, NOW)
		expect(over?.media?.positionMs).toBe(20_000)
	})

	it('暂停：速率为 0，位置不动；字段不对的不带', () => {
		expect(liveDeskFrom(state({ playback: { state: 'paused', durationMs: 200_000, positionMs: 10_000, anchorAt: '2026-09-25T09:00:00.000Z', rate: 0 } }), {}, NOW)?.media).toMatchObject({ playing: false, positionMs: 10_000 })
		const bad = liveDeskFrom(state({ playback: { state: 'playing', durationMs: -1, positionMs: 'x', rate: 9 } }), {}, NOW)?.media
		expect(bad).not.toHaveProperty('positionMs')
		expect(bad).not.toHaveProperty('durationMs')
	})
})

describe('图片与链接', () => {
	it('图标与封面换成转发地址；不给转发函数就不带图片', () => {
		const desk = liveDeskFrom(state({ artwork: { url: `https://img.example.test/a.png?v=${'a'.repeat(64)}` } }), { imageUrlOf: liveDeskImageUrlOf }, NOW)
		expect(desk?.app?.icon).toMatch(/^\/api\/mx\/live-desk\/image\?u=/)
		expect(desk?.media?.artwork).toMatch(/^\/api\/mx\/live-desk\/image\?u=/)
		const plain = liveDeskFrom(state({ artwork: { url: 'https://img.example.test/a.png' } }), {}, NOW)
		expect(plain?.app).not.toHaveProperty('icon')
		expect(plain?.media).not.toHaveProperty('artwork')
	})

	it('签名：只有签出来的地址对得上，改一个字就不对', () => {
		const url = 'https://cdn.example.test/vscode.png'
		const signature = signImageUrl(url)
		expect(verifyImageUrl(url, signature)).toBe(true)
		expect(verifyImageUrl('https://cdn.example.test/other.png', signature)).toBe(false)
		expect(verifyImageUrl(url, `${signature.slice(0, -1)}x`)).toBe(false)
		expect(verifyImageUrl(url, '')).toBe(false)
	})

	it('能转发的地址：https、没有用户名与端口、主机不是 IP 或本机', () => {
		expect(proxiableImageUrl('https://cdn.example.test/a.png')).toBe('https://cdn.example.test/a.png')
		for (const bad of ['http://cdn.example.test/a.png', 'https://user:pw@cdn.example.test/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://localhost/a.png', 'https://printer.local/a.png', 'https://cdn.example.test:8443/a.png', 'javascript:alert(1)', `https://cdn.example.test/${'x'.repeat(3000)}`])
			expect(proxiableImageUrl(bad), bad).toBeUndefined()
		expect(liveDeskImageUrlOf('http://cdn.example.test/a.png')).toBeUndefined()
	})

	it('歌曲链接只认 QQ 音乐与网易云的规范地址', () => {
		expect(mediaLinkOf('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV')).toBe('https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV')
		expect(mediaLinkOf('https://music.163.com/song?id=186016')).toBe('https://music.163.com/song?id=186016')
		for (const bad of ['https://music.163.com/song?id=0', 'https://music.163.com/song?id=1&x=2', 'http://music.163.com/song?id=1', 'https://evil.test/song?id=1', 'https://y.qq.com/n/ryqq/songDetail/short', 'javascript:alert(1)'])
			expect(mediaLinkOf(bad), bad).toBeUndefined()
	})
})
