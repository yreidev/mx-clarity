/**
 * 访客提交内容的通用校验（评论、友链申请）。纯模块。
 */

// 不用 `[^\s@]+\.[^\s@]+` 这种写法：两段都能吃掉点号，长输入会回溯
const MAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

export function isMailAddress(value: string) {
	return value.length <= 50 && MAIL.test(value)
}

/** 去掉首尾空白；不是字符串时当空串 */
export function stringField(value: unknown) {
	return typeof value === 'string' ? value.trim() : ''
}

export function objectField(value: unknown) {
	return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
}
