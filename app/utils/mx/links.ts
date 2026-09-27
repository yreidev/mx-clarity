/**
 * 友链申请：申请表的校验、提交与失败文案。纯模块，浏览器直连 core 时用，不带正文渲染。
 */
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { msg } from '~~/shared/utils/i18n'
import { safeUrl } from './adapter'
import { isMailAddress, objectField, stringField } from './validate'

export interface LinkApplication {
	/** 申请人的称呼 */
	author: string
	/** 站名 */
	name: string
	url: string
	avatar?: string
	description?: string
	email?: string
}

const HTTPS_URL = /^https:\/\//i

/**
 * 友链申请表 → 发给 core 的内容；不合要求时返回给访客看的提示。长度上限照 core 的校验。
 * 头像只收 http(s)：core 那边任何协议都收
 */
export function parseLinkApplication(body: unknown): LinkApplication | string {
	const input = objectField(body)
	const author = stringField(input.author)
	const name = stringField(input.name)
	const url = stringField(input.url)
	const avatar = stringField(input.avatar)
	const description = stringField(input.description)
	const email = stringField(input.email)
	if (!author || author.length > 20)
		return msg('friends.nameRequiredUp')
	if (!name || name.length > 20)
		return msg('friends.siteNameRequired')
	if (!HTTPS_URL.test(url) || url.length > 200 || !safeUrl(url))
		return msg('friends.siteUrlMust')
	if (avatar && (avatar.length > 200 || !safeUrl(avatar)))
		return msg('friends.avatarUrlMust')
	if (description.length > 50)
		return msg('friends.descriptionCanUp')
	if (email && !isMailAddress(email))
		return msg('friends.invalidEmailOptional')
	return {
		author,
		name,
		url,
		avatar: avatar || undefined,
		description: description || undefined,
		email: email || undefined,
	}
}

/**
 * 没填的可选项**不带**，不能给 null：core 的 `description` 是 `optional` 不是 `nullable`，
 * 给 null 会 400 `VALIDATION_FAILED`（2026-09-24 实测）
 */
export async function applyLink(client: MxClient, application: LinkApplication) {
	const { author, name, url, avatar, description, email } = application
	await client.link.applyLink({
		author,
		name,
		url,
		...(avatar ? { avatar } : {}),
		...(description ? { description } : {}),
		...(email ? { email } : {}),
	} as Parameters<MxClient['link']['applyLink']>[0])
}

/** 友链申请失败 → 固定文案。状态码照 core 的错误定义 */
export function linkErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.code) {
		case 'LINK_APPLY_DISABLED':
			return { statusCode: 403, message: msg('friends.ownerIsntAccepting') }
		case 'DUPLICATE_LINK':
			return { statusCode: 400, message: msg('friends.siteAlreadyListed') }
		case 'LINK_DISABLED':
			return { statusCode: 400, message: msg('friends.siteCantRequest') }
		case 'SUBPATH_LINK_DISABLED':
			return { statusCode: 422, message: msg('friends.onlySitesHome') }
		case 'VALIDATION_FAILED':
			return { statusCode: 400, message: msg('friends.invalidInputPlease') }
	}
	if (failure.status === 409)
		return { statusCode: 409, message: msg('friends.youveJustSubmitted') }
	switch (failure.kind) {
		case 'rate-limited':
			return { statusCode: 429, message: msg('friends.youreSubmittingToo') }
		case 'unavailable':
			return { statusCode: 503, message: msg('friends.serviceTemporarilyUnavailable') }
		default:
			return { statusCode: 500, message: msg('friends.couldntSubmitPlease') }
	}
}
