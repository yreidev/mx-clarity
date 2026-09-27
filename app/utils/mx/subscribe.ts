/**
 * 邮件订阅（core 的 `/subscribe`）。纯模块，浏览器直连 core 时调用。
 *
 * core 只在发文章、日记时发信（说说、碎碎念订阅了也收不到），所以只开放 `post_c`、`note_c`。
 * core 不确认邮箱、也不限次数，任何人都能替别人订阅，README 写明
 */
import type { SubscribeStatus, SubscribeType } from '../../types/subscribe'
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { msg } from '~~/shared/utils/i18n'
import { isMailAddress, objectField, stringField } from './validate'

export const SUBSCRIBE_TYPES: SubscribeType[] = ['post_c', 'note_c']

/** `check()` 的 `bitMap` 键会被 camelCase 改写，只用 `enable` 与 `allowTypes`（值不变） */
export function subscribeStatusFrom(raw: unknown): SubscribeStatus {
	const data = objectField(raw)
	const allowed = Array.isArray(data.allowTypes) ? data.allowTypes : []
	const types = SUBSCRIBE_TYPES.filter(type => allowed.includes(type))
	return { enable: data.enable === true && types.length > 0, types }
}

export async function loadSubscribeStatus(client: MxClient) {
	return subscribeStatusFrom(await client.subscribe.check())
}

/** 浏览器交来的订阅请求；不合格时返回提示 */
export function parseSubscribe(body: unknown, allowed: readonly SubscribeType[] = SUBSCRIBE_TYPES): { email: string, types: SubscribeType[] } | string {
	const input = objectField(body)
	const email = stringField(input.email).toLowerCase()
	if (!isMailAddress(email))
		return msg('subscribe.invalidEmailUp')
	const types = Array.isArray(input.types) ? [...new Set(input.types)] : []
	if (!types.length || !types.every((type): type is SubscribeType => allowed.includes(type as SubscribeType)))
		return msg('subscribe.chooseWhatWant')
	return { email, types }
}

export async function subscribe(client: MxClient, email: string, types: SubscribeType[]) {
	await client.subscribe.subscribe(email, types)
}

export function subscribeErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.code) {
		case 'SUBSCRIBE_NOT_ENABLED':
			return { statusCode: 403, message: msg('subscribe.ownerHasntEnabled') }
		case 'SUBSCRIBE_TYPE_EMPTY':
		case 'INVALID_SUBSCRIBE_TYPE':
		case 'VALIDATION_FAILED':
			return { statusCode: 400, message: msg('subscribe.invalidEmailSubscription') }
	}
	if (failure.kind === 'rate-limited')
		return { statusCode: 429, message: msg('common.tooManyRequests') }
	return { statusCode: 503, message: msg('subscribe.couldntSubscribePlease') }
}
