import { Temporal } from 'temporal-polyfill'
import { afterEach, describe, expect, it, vi } from 'vitest'
import blogConfig from '../../blog.config'
import { toZonedLocaleString } from '../../shared/utils/time'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('日期格式不交给运行环境', () => {
	it('toZdtLocaleString 显式传站点语言，结果与进程默认语言无关', () => {
		const spy = vi.spyOn(Temporal.ZonedDateTime.prototype, 'toLocaleString')
		const text = toZonedLocaleString('2026-09-24T01:00:00.000Z', 'Asia/Shanghai', 'date')
		expect(spy.mock.calls.map(c => c[0])).toEqual([blogConfig.language])
		// 容器里的默认语言是 en-US：两种写法不同，才会出现水合不一致
		expect(text).toBe('2026/09/24')
		expect(new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date('2026-09-24T01:00:00.000Z'))).toBe('09/24/2026')
	})

	it('按站点时区取日期：同一时刻在东八区已是第二天，在纽约还是前一天', () => {
		expect(toZonedLocaleString('2026-09-23T16:30:00.000Z', 'Asia/Shanghai', 'date')).toBe('2026/09/24')
		expect(toZonedLocaleString('2026-09-23T16:30:00.000Z', 'America/New_York', 'date')).toBe('2026/09/23')
	})
})
