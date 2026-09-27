/**
 * 结构化日志：一行一个 JSON，写到标准输出（容器日志里好筛）。
 * 降级（core 的某个接口失败、页面退到兜底）一律打 `mx.degraded`，带接口路径、失败类型、HTTP 状态与 core 的错误码；
 * 限流（`rate-limited`）另在进程内计数，每条日志带上累计值。
 */
import type { MxFailure } from '~~/app/utils/mx/errors'
import process from 'node:process'
import { noteCoreFailure } from './core-health'

type Level = 'info' | 'warn' | 'error'

let rateLimitedTotal = 0

export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}) {
	const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields })
	if (level === 'error')
		console.error(line)
	else if (level === 'warn')
		console.warn(line)
	else
		process.stdout.write(`${line}\n`)
}

/**
 * 一次降级。`not-found` 不记：那是正常结果（内容不存在）。
 * 路径只留到 `?` 之前：日记解锁的密码是以查询参数带给 core 的，不能进日志
 */
export function logDegraded(source: string, failure: MxFailure) {
	if (failure.kind === 'not-found')
		return
	noteCoreFailure(failure)
	if (failure.kind === 'rate-limited')
		rateLimitedTotal++
	logEvent(failure.kind === 'invalid-request' ? 'error' : 'warn', 'mx.degraded', {
		source,
		kind: failure.kind,
		status: failure.status,
		code: failure.code,
		...(failure.path ? { path: failure.path.split('?')[0] } : {}),
		rateLimitedTotal,
	})
}
