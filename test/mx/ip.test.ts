import { describe, expect, it } from 'vitest'
import { resolveVisitorIp } from '../../app/utils/mx/ip'

describe('访客 IP 取我们自己的代理认证过的值', () => {
	it('x-forwarded-for 取最右段——最左段是客户端可控的', () => {
		expect(resolveVisitorIp({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }, '10.0.0.2')).toBe('203.0.113.9')
	})

	it('客户端伪造一整串也只认最右段', () => {
		expect(resolveVisitorIp({ 'x-forwarded-for': '8.8.8.8,9.9.9.9 , 198.51.100.7' }, '10.0.0.2')).toBe('198.51.100.7')
	})

	it('多个同名头合并后仍取最右段', () => {
		expect(resolveVisitorIp({ 'x-forwarded-for': ['1.1.1.1', '203.0.113.9'] }, undefined)).toBe('203.0.113.9')
	})

	it('x-real-ip 模式只读 x-real-ip，不看 xff', () => {
		const headers = { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' }
		expect(resolveVisitorIp(headers, '10.0.0.2', 'x-real-ip')).toBe('203.0.113.9')
	})

	it('没有代理头时退到直连地址（本地开发）', () => {
		expect(resolveVisitorIp({}, '127.0.0.1')).toBe('127.0.0.1')
		expect(resolveVisitorIp({}, '::1')).toBe('::1')
	})

	it('非法值不转发', () => {
		expect(resolveVisitorIp({ 'x-forwarded-for': '1.1.1.1, <script>' }, 'not-an-ip')).toBeUndefined()
		expect(resolveVisitorIp({ 'x-forwarded-for': '999.1.1.1' }, undefined)).toBeUndefined()
	})

	it('支持 IPv6', () => {
		expect(resolveVisitorIp({ 'x-forwarded-for': '2001:db8::1' }, undefined)).toBe('2001:db8::1')
	})
})
