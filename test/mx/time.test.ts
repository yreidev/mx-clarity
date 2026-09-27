import { Temporal } from 'temporal-polyfill'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAtomFeed } from '../../app/utils/mx/feed'
import { isSameUnit, isTimeDiffSignificant, isValidTimeZone, resolveTimeZone, timeElapse, toInstantString, toZonedTemporal } from '../../shared/utils/time'

afterEach(() => {
	vi.useRealTimers()
})

describe('站点时区的来源', () => {
	it('主题配置 ＞ 主题进程的时区 ＞ UTC，认不得的名字跳过', () => {
		expect(resolveTimeZone('America/New_York', 'Asia/Shanghai')).toBe('America/New_York')
		expect(resolveTimeZone('', 'Asia/Shanghai')).toBe('Asia/Shanghai')
		expect(resolveTimeZone('Mars/Olympus', 'Asia/Tokyo')).toBe('Asia/Tokyo')
		expect(resolveTimeZone(undefined, 'Nowhere/City')).toBe('UTC')
		expect(resolveTimeZone(undefined, undefined)).toBe('UTC')
	})

	it('只认运行环境认得的 IANA 名，拒绝非字符串与过长的值', () => {
		expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
		expect(isValidTimeZone('UTC')).toBe(true)
		expect(isValidTimeZone('Mars/Olympus')).toBe(false)
		expect(isValidTimeZone('')).toBe(false)
		expect(isValidTimeZone(8)).toBe(false)
		expect(isValidTimeZone(`${'A'.repeat(65)}`)).toBe(false)
	})
})

describe('换算到站点时区', () => {
	it('同一时刻在不同时区是不同的日子与年份', () => {
		const moment = '2024-12-31T20:00:00Z'
		expect(toZonedTemporal(moment, 'Asia/Shanghai').toPlainDate().toString()).toBe('2025-01-01')
		expect(toZonedTemporal(moment, 'UTC').toPlainDate().toString()).toBe('2024-12-31')
		expect(toZonedTemporal(moment, 'America/New_York').year).toBe(2024)
	})

	it('自带时区的时间换算到站点时区；没带时区的日期时间当成站点时区的时间', () => {
		expect(toZonedTemporal('2024-06-01T09:00:00+09:00[Asia/Tokyo]', 'Asia/Shanghai').hour).toBe(8)
		const plain = toZonedTemporal('2024-06-01T00:00:00', 'America/New_York')
		expect(plain.hour).toBe(0)
		expect(plain.timeZoneId).toBe('America/New_York')
	})

	it('isSameUnit 按站点时区的钟面时间算「相差不到一个单位」', () => {
		// 纽约 2024-03-10 进入夏令时：两个时刻只差 23.5 小时，钟面上却是 01:00 → 次日 01:30，超过一天
		const a = '2024-03-10T06:00:00Z'
		const b = '2024-03-11T05:30:00Z'
		expect(isSameUnit(a, b, 'day', 'America/New_York')).toBe(false)
		expect(isSameUnit(a, b, 'day', 'UTC')).toBe(true)
	})

	it('toInstantString 与 isTimeDiffSignificant 只看时刻，与时区无关', () => {
		expect(toInstantString(toZonedTemporal('2024-06-01T00:00:00Z', 'Asia/Shanghai'))).toBe('2024-06-01T00:00:00Z')
		vi.useFakeTimers({ now: Date.parse('2026-01-01T00:00:00Z') })
		expect(isTimeDiffSignificant('2025-12-31T00:00:00Z', '2020-01-01T00:00:00Z')).toBe(true)
		expect(isTimeDiffSignificant('2025-12-31T00:00:00Z', '2025-12-31T01:00:00+08:00')).toBe(false)
	})

	it('timeElapse 从站点时区的现在算起', () => {
		// UTC 的 2026-01-01 20:00 在东八区已是 1 月 2 日 04:00
		vi.useFakeTimers({ now: Date.parse('2026-01-01T20:00:00Z') })
		expect(Temporal.Now.plainDateISO('Asia/Shanghai').toString()).toBe('2026-01-02')
		expect(timeElapse('2026-01-02', 'Asia/Shanghai')).toBe('4小时')
		expect(timeElapse('2026-01-01', 'UTC')).toBe('20小时')
	})
})

describe('订阅源的版权年份', () => {
	const site = { title: 't', description: 'd', url: 'https://blog.example.com/', author: { name: '博主' }, language: 'zh-CN' }
	const entry = { title: 'a', path: '/posts/a/b', category: '分享', published: '2024-12-31T20:00:00Z' }

	it('按站点时区算；不给时区按 UTC', () => {
		expect(buildAtomFeed({ ...site, timeZone: 'Asia/Shanghai' }, [entry])).toContain('<rights>© 2025 博主</rights>')
		expect(buildAtomFeed(site, [entry])).toContain('<rights>© 2024 博主</rights>')
	})
})
