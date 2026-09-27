import { afterEach, describe, expect, it, vi } from 'vitest'
import { coreFailedSince } from '../../server/utils/core-health'
import { logDegraded } from '../../server/utils/log'

afterEach(() => {
	vi.restoreAllMocks()
})

function captured() {
	const lines: string[] = []
	vi.spyOn(console, 'warn').mockImplementation((line: string) => lines.push(line))
	vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(line))
	return () => lines.map(line => JSON.parse(line) as Record<string, unknown>)
}

describe('降级日志', () => {
	it('一行一个 JSON：来源、失败类型、状态、错误码、路径；路径去掉查询参数（日记密码是查询参数）', () => {
		const lines = captured()
		logDegraded('note-unlock', { kind: 'unavailable', status: 0, code: 'NETWORK_ERROR', message: 'x', path: '/notes/nid/3?password=hunter2&lang=zh' })
		const [line] = lines()
		expect(line).toMatchObject({ level: 'warn', event: 'mx.degraded', source: 'note-unlock', kind: 'unavailable', status: 0, code: 'NETWORK_ERROR', path: '/notes/nid/3' })
		expect(JSON.stringify(line)).not.toContain('hunter2')
		expect(typeof line!.time).toBe('string')
	})

	it('not-found 是正常结果，不记；参数不对记成 error', () => {
		const lines = captured()
		logDegraded('post', { kind: 'not-found', status: 404, code: 'NOT_FOUND', message: 'x' })
		logDegraded('comment', { kind: 'invalid-request', status: 422, code: '422', message: 'x' })
		expect(lines().map(line => [line.level, line.kind])).toEqual([['error', 'invalid-request']])
	})

	it('限流进程内计数，每条都带累计值', () => {
		const lines = captured()
		logDegraded('like', { kind: 'rate-limited', status: 429, code: 'RATE_LIMITED', message: 'x' })
		logDegraded('like', { kind: 'rate-limited', status: 429, code: 'RATE_LIMITED', message: 'x' })
		const [first, second] = lines().map(line => line.rateLimitedTotal as number)
		expect(second).toBe(first! + 1)
	})

	it('降级同时记下 core 失败的时刻（这段时间渲染的页面不进整页缓存）；not-found 与参数错不算', () => {
		captured()
		const start = Date.now() + 60_000
		vi.spyOn(Date, 'now').mockReturnValue(start)
		logDegraded('post', { kind: 'not-found', status: 404, code: 'NOT_FOUND', message: 'x' })
		logDegraded('comment', { kind: 'invalid-request', status: 422, code: '422', message: 'x' })
		expect(coreFailedSince(start)).toBe(false)
		logDegraded('site-config', { kind: 'unavailable', status: 503, code: '503', message: 'x' })
		expect(coreFailedSince(start)).toBe(true)
	})
})
