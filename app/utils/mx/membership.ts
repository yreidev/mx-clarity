/**
 * 付费文章与会员的取数、映射与结账。纯模块：付费墙随页面由服务端取，「我的会员」与结账在浏览器里直连 core。
 *
 * 谁能读由 core 判定（`EntitlementService`），锁定时正文也由 core 截断，主题只照着显示。
 * 结账拿到的收银台地址只认 https；返回地址只收站内路径。
 */
import type { ArticleAccess, ArticlePaywall, CheckoutRequest, EntitlementReason, MembershipMe, MembershipOffers, MembershipPlan, MembershipProvider, MembershipState, MembershipStatus, PlanPrice, PremiumArticle, Price } from '../../types/membership'
import type { MxClient } from './client'
import type { MxFailure } from './errors'
import { msg } from '~~/shared/utils/i18n'
import { classifyMxError } from './errors'
import { objectField, stringField } from './validate'

const REASONS = new Set<EntitlementReason>(['public', 'owner', 'free-window', 'purchase', 'membership', 'locked'])
const PLANS = new Set<MembershipPlan>(['monthly', 'yearly'])
const STATUSES = new Set<MembershipStatus>(['none', 'active', 'on_hold', 'cancelled', 'expired'])
const PROVIDERS = new Set<MembershipProvider>(['dodo', 'creem', 'lemonsqueezy', 'stripe', 'manual', 'apple'])
const INTERVALS = new Set<PlanPrice['interval']>(['day', 'week', 'month', 'year'])
const CURRENCY = /^[A-Z]{3}$/
const SNOWFLAKE = /^\d{1,20}$/
const HTTPS_URL = /^https:\/\//i

function isDate(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function reasonOf(value: unknown): EntitlementReason | undefined {
	return REASONS.has(value as EntitlementReason) ? value as EntitlementReason : undefined
}

function priceOf(value: unknown): Price | undefined {
	const { amount, currency } = objectField(value)
	if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || typeof currency !== 'string' || !CURRENCY.test(currency))
		return undefined
	return { amount, currency }
}

function planPriceOf(value: unknown): PlanPrice | undefined {
	const price = priceOf(value)
	const { interval, intervalCount } = objectField(value)
	if (!price || !INTERVALS.has(interval as PlanPrice['interval']))
		return undefined
	const count = typeof intervalCount === 'number' && Number.isSafeInteger(intervalCount) && intervalCount > 0 ? intervalCount : 1
	return { ...price, interval: interval as PlanPrice['interval'], intervalCount: count }
}

/**
 * 文章详情的 `$meta.paywall` → 付费墙；不是付费文章（没有这一段）时返回空。
 * 认不出的 `reason` 按 `locked` 推：锁着就当锁定，没锁就当公开，不瞎给「已解锁」之类的标记
 */
export function paywallFrom(meta: unknown): ArticlePaywall | undefined {
	const raw = objectField(objectField(meta).paywall)
	if (typeof raw.locked !== 'boolean')
		return undefined
	const purchase = objectField(raw.purchase)
	const previewBlocks = raw.previewBlocks
	return {
		locked: raw.locked,
		reason: reasonOf(objectField(raw.entitlement).reason) ?? (raw.locked ? 'locked' : 'public'),
		freeUntil: isDate(raw.freeUntil) ? raw.freeUntil : undefined,
		previewBlocks: typeof previewBlocks === 'number' && Number.isSafeInteger(previewBlocks) && previewBlocks >= 0 ? previewBlocks : undefined,
		purchasable: purchase.enabled === true,
		price: priceOf(purchase.price),
	}
}

/** `GET /membership/plans` → 方案与单篇解锁。价格查不到时没有价格字段 */
export function offersFrom(plans: unknown): MembershipOffers {
	const raw = objectField(plans)
	const article = objectField(raw.articlePurchase)
	const seen = new Set<MembershipPlan>()
	const list = (Array.isArray(raw.plans) ? raw.plans : []).flatMap((item) => {
		const { plan, pricing } = objectField(item)
		if (!PLANS.has(plan as MembershipPlan) || seen.has(plan as MembershipPlan))
			return []
		seen.add(plan as MembershipPlan)
		return [{ plan: plan as MembershipPlan, price: planPriceOf(pricing) }]
	})
	return {
		enabled: raw.enabled === true,
		plans: list,
		article: { enabled: article.enabled === true, price: priceOf(article.price) },
		appleIap: { enabled: objectField(raw.appleIap).enabled === true },
	}
}

export async function loadOffers(client: MxClient) {
	return offersFrom(await client.membership.plans())
}

/** `GET /membership/status` → 会员状态，只取状态、方案、到期时间、开通方式 */
export function membershipStateFrom(status: unknown): MembershipState {
	const raw = objectField(status)
	const state = STATUSES.has(raw.status as MembershipStatus) ? raw.status as MembershipStatus : 'none'
	if (state === 'none')
		return { status: 'none' }
	return {
		status: state,
		plan: PLANS.has(raw.plan as MembershipPlan) ? raw.plan as MembershipPlan : undefined,
		currentPeriodEnd: isDate(raw.currentPeriodEnd) ? raw.currentPeriodEnd : undefined,
		provider: PROVIDERS.has(raw.provider as MembershipProvider) ? raw.provider as MembershipProvider : undefined,
	}
}

/** `GET /membership/archive` 的一篇；分类只有 slug（实测，api-client 类型里的 name 不存在） */
export function premiumArticleFrom(item: unknown): PremiumArticle | undefined {
	const raw = objectField(item)
	const id = stringField(raw.id)
	const slug = stringField(raw.slug)
	const category = stringField(objectField(raw.category).slug)
	if (!SNOWFLAKE.test(id) || !slug || !category || !isDate(raw.createdAt))
		return undefined
	return {
		id,
		title: stringField(raw.title) || slug,
		path: `/posts/${category}/${slug}`,
		date: raw.createdAt,
		entitlement: reasonOf(raw.entitlement) ?? 'locked',
		freeUntil: isDate(raw.freeUntil) ? raw.freeUntil : undefined,
	}
}

/**
 * 会员页的个人部分。`signedIn` 为假（没带读者 cookie）时不问状态；
 * 会话过期（401）当作没登录。付费文章清单匿名也能读，带会话时每篇给的是本人的解锁状态
 */
export async function loadMembershipMe(client: MxClient, signedIn: boolean): Promise<MembershipMe> {
	const [membership, archive] = await Promise.all([
		signedIn
			? client.membership.status().then(membershipStateFrom).catch((error) => {
					if (classifyMxError(error).kind === 'unauthorized')
						return null
					throw error
				})
			: null,
		client.membership.archive(),
	])
	const posts = Array.isArray(objectField(archive).posts) ? objectField(archive).posts as unknown[] : []
	return { membership, articles: posts.flatMap(item => premiumArticleFrom(item) ?? []) }
}

/**
 * 限时公开期间本人到期后还能不能读。没登录、会话过期或查不到都当作不能，只影响提示文字
 */
export async function loadArticleAccess(client: MxClient, postId: string, signedIn: boolean): Promise<ArticleAccess> {
	if (!signedIn)
		return { member: false, purchased: false }
	const [state, purchase] = await Promise.all([
		client.membership.status().then(membershipStateFrom).catch(() => undefined),
		client.membership.articlePurchased(postId).catch(() => undefined),
	])
	return {
		member: state?.status === 'active' || state?.status === 'on_hold',
		purchased: objectField(purchase).purchased === true,
	}
}

const RETURN_PATH_MAX = 512

/** 站内路径：`/` 开头、不是 `//`、没有反斜杠与控制字符（core 另有同样的校验） */
export function isSitePath(value: unknown): value is string {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > RETURN_PATH_MAX)
		return false
	return !value.includes('\\') && ![...value].some((char) => {
		const code = char.charCodeAt(0)
		return code < 32 || code === 127
	})
}

/** 浏览器发来的结账请求；不合要求时返回给读者看的提示 */
export function parseCheckoutRequest(body: unknown): CheckoutRequest | string {
	const raw = objectField(body)
	if (!isSitePath(raw.returnPath))
		return msg('common.invalidRequestPlease')
	if (raw.kind === 'membership' && PLANS.has(raw.plan as MembershipPlan))
		return { kind: 'membership', plan: raw.plan as MembershipPlan, returnPath: raw.returnPath }
	if (raw.kind === 'article' && typeof raw.postId === 'string' && SNOWFLAKE.test(raw.postId))
		return { kind: 'article', postId: raw.postId, returnPath: raw.returnPath }
	return msg('common.invalidRequestPlease')
}

/** core 给的收银台地址不是 https 时当作服务出错，不把读者带去别的协议 */
export class UnsafeCheckoutUrlError extends Error {}

export async function startCheckout(client: MxClient, request: CheckoutRequest) {
	const result = request.kind === 'membership'
		? await client.membership.checkout(request.plan, request.returnPath)
		: await client.membership.articleCheckout(request.postId, request.returnPath)
	const url = objectField(result).checkoutUrl
	if (typeof url !== 'string' || !HTTPS_URL.test(url))
		throw new UnsafeCheckoutUrlError('checkout url is not https')
	return { checkoutUrl: url }
}

/**
 * 结账失败 → 给读者看的提示。**只用固定文案**。
 * 错误码按 core 源码（`membership.controller.ts`）与本地实测（2026-09-24）
 */
export function checkoutErrorOf(failure: MxFailure): { statusCode: number, message: string } {
	switch (failure.code) {
		case 'AUTH_NOT_LOGGED_IN':
		case 'AUTH_SESSION_EXPIRED':
			return { statusCode: 401, message: msg('common.pleaseSignFirst') }
		case 'MEMBERSHIP_ALREADY_ACTIVE':
			return { statusCode: 409, message: msg('membership.youreAlreadyMember') }
		case 'ARTICLE_ALREADY_PURCHASED':
			return { statusCode: 409, message: msg('membership.youveAlreadyUnlocked') }
		case 'ARTICLE_NOT_PURCHASABLE':
			return { statusCode: 400, message: msg('membership.postCantUnlocked') }
		case 'ARTICLE_PURCHASE_UNAVAILABLE':
			return { statusCode: 400, message: msg('membership.singlePostUnlocks') }
		case 'MEMBERSHIP_PROVIDER_NOT_CONFIGURED':
			return { statusCode: 400, message: msg('membership.membershipIsntAvailable') }
		case 'DEMO_FORBIDDEN':
			return { statusCode: 403, message: msg('membership.paymentsDisabledDemo') }
	}
	switch (failure.kind) {
		case 'unauthorized':
			return { statusCode: 401, message: msg('common.pleaseSignFirst') }
		case 'not-found':
			return { statusCode: 404, message: msg('membership.postDoesntExist') }
		case 'rate-limited':
			return { statusCode: 429, message: msg('common.tooManyRequests') }
		case 'invalid-request':
			return { statusCode: 400, message: msg('common.invalidRequestPlease') }
		default:
			return { statusCode: 503, message: msg('membership.paymentsTemporarilyUnavailable') }
	}
}
