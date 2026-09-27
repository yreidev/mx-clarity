import { describe, expect, it } from 'vitest'
import { mediaUrlOf, videoSrcOf } from '../../shared/utils/video'

describe('视频嵌入的地址', () => {
	it('各平台的 id 按格式校验后拼地址', () => {
		expect(videoSrcOf('bilibili', 'BV1xx411c7mD')).toBe('https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=false')
		expect(videoSrcOf('youtube', 'dQw4w9WgXcQ', true)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&disablekb=1&playsinline=1&autoplay=true')
		expect(videoSrcOf('douyin-wide', '7123456789012345678')).toBe('https://open.douyin.com/player/video?vid=7123456789012345678')
		expect(videoSrcOf('tiktok', '7123456789012345678')).toBe('https://www.tiktok.com/embed/v3/7123456789012345678')
	})

	it('不认的平台、不合格的 id 一律不给地址', () => {
		for (const [type, id] of [
			['x', 'javascript:alert(1)'],
			[undefined, 'https://evil.example/'],
			['youtube', 'abc"onload="x'],
			['youtube', 'dQw4w9WgXcQ&list=1'],
			['bilibili', 'BV1xx411c7mD/../../x'],
			['douyin', '123abc'],
			['raw', 'javascript:alert(2)'],
			['raw', 'data:video/mp4;base64,AAAA'],
			['bilibili', 42],
		] as const)
			expect(videoSrcOf(type, id), `${type} ${id}`).toBeUndefined()
	})

	it('raw 视频与封面只收站内路径与 http(s)', () => {
		expect(mediaUrlOf('/objects/clip.mp4')).toBe('/objects/clip.mp4')
		expect(mediaUrlOf('https://cdn.example/clip.mp4')).toBe('https://cdn.example/clip.mp4')
		for (const bad of ['//evil.example/x.mp4', '/\\evil.example', '/\t/evil.example', ' https://x', 'javascript:alert(1)', 'vbscript:x', 'clip.mp4', undefined, 7])
			expect(mediaUrlOf(bad), String(bad)).toBeUndefined()
	})
})
