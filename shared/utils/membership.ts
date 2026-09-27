/**
 * 付费文章与会员的显示文字。纯函数，页面和测试共用；`lang` 是界面语言（`useUiLang()`），不给是中文。
 */
import type { UiLang } from './i18n'
import { translate } from './i18n'

interface PriceLike {
	/** 最小货币单位（美元即美分），与 Dodo 一致 */
	amount: number
	currency: string
}

interface PlanPriceLike extends PriceLike {
	interval: 'day' | 'week' | 'month' | 'year'
	intervalCount: number
}

/** 按货币的小数位把最小单位换回来：美元 299 → US$2.99，日元没有小数位 */
export function formatPrice(price: PriceLike, locale = 'zh-CN') {
	try {
		const format = new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency })
		const digits = format.resolvedOptions().maximumFractionDigits ?? 2
		return format.format(price.amount / 10 ** digits)
	}
	catch {
		return `${(price.amount / 100).toFixed(2)} ${price.currency}`
	}
}

/** 周期的写法（`/ 月`、`/ 3 个月`）；英文分单复数 */
function intervalText(price: PlanPriceLike, lang: UiLang) {
	const n = price.intervalCount
	switch (price.interval) {
		case 'day':
			return n > 1 ? translate(lang, 'membership.days', { n }) : translate(lang, 'membership.day')
		case 'week':
			return n > 1 ? translate(lang, 'membership.weeks', { n }) : translate(lang, 'membership.week')
		case 'month':
			return n > 1 ? translate(lang, 'membership.months', { n }) : translate(lang, 'membership.month')
		default:
			return n > 1 ? translate(lang, 'membership.years', { n }) : translate(lang, 'membership.year')
	}
}

export function formatPlanPrice(price: PlanPriceLike, locale?: string, lang: UiLang = 'zh') {
	return `${formatPrice(price, locale)} ${intervalText(price, lang)}`
}

export function planLabel(plan: 'monthly' | 'yearly', lang: UiLang = 'zh') {
	return plan === 'monthly' ? translate(lang, 'membership.monthlyMembership') : translate(lang, 'membership.yearlyMembership')
}

const DAY = 86_400_000
const HOUR = 3_600_000
const MINUTE = 60_000

/** 离某个时间还剩多久，粗到天 / 小时 / 分钟；已经过了返回空 */
export function remainingText(until: string, now: number, lang: UiLang = 'zh') {
	const left = Date.parse(until) - now
	if (!Number.isFinite(left) || left <= 0)
		return undefined
	if (left >= DAY)
		return translate(lang, 'membership.days2', { n: Math.floor(left / DAY) })
	if (left >= HOUR)
		return translate(lang, 'membership.hours', { n: Math.floor(left / HOUR) })
	return translate(lang, 'membership.minutes', { n: Math.max(1, Math.floor(left / MINUTE)) })
}

type Reason = 'public' | 'owner' | 'free-window' | 'purchase' | 'membership' | 'locked'
type Status = 'none' | 'active' | 'on_hold' | 'cancelled' | 'expired'

/** 限时公开期间，本人到期后还能不能读：会员、买过这篇的不受影响 */
export interface FreeWindowAccess {
	member: boolean
	purchased: boolean
}

/**
 * 文章头部的付费标记：锁定「付费内容」、限时公开「限时公开 · 剩 X」（会员、买过的另有说法）、
 * 买过「已永久解锁」、站长「付费文章」；会员与公开不加标记
 */
export function paywallBadgeOf(paywall: { reason: Reason, freeUntil?: string }, now: number, access?: FreeWindowAccess, lang: UiLang = 'zh') {
	switch (paywall.reason) {
		case 'locked':
			return { icon: 'tabler:lock', text: translate(lang, 'membership.membersOnlyContent') }
		case 'free-window': {
			if (access?.member)
				return { icon: 'tabler:hourglass', text: translate(lang, 'membership.freeLimitedTimeYoure') }
			if (access?.purchased)
				return { icon: 'tabler:hourglass', text: translate(lang, 'membership.freeLimitedTimePurchased') }
			const left = paywall.freeUntil ? remainingText(paywall.freeUntil, now, lang) : undefined
			return { icon: 'tabler:hourglass', text: left ? translate(lang, 'membership.freeLimitedTimeLeft', { left }) : translate(lang, 'membership.freeLimitedTime') }
		}
		case 'purchase':
			return { icon: 'tabler:lock-open', text: translate(lang, 'membership.unlockedGood') }
		case 'owner':
			return { icon: 'tabler:crown', text: translate(lang, 'membership.membersOnlyPost') }
		default:
			return undefined
	}
}

/** 限时公开标记的悬停说明：到期的具体时间，以及到期后本人还能不能读 */
export function freeWindowTipOf(freeUntil: string | undefined, access: FreeWindowAccess | undefined, formatDate: (date: string) => string, lang: UiLang = 'zh') {
	const until = freeUntil ? translate(lang, 'membership.freeReadUntil', { date: formatDate(freeUntil) }) : translate(lang, 'membership.freeReadLimited')
	if (access?.member)
		return translate(lang, 'membership.youreMemberSo', { until })
	if (access?.purchased)
		return translate(lang, 'membership.boughtPostSo', { until })
	return translate(lang, 'membership.afterwardMembersBuyers', { until })
}

/** core 把 `on_hold`（续费失败、还在当期内）也算有效会员，照常能读全文，也不能再下单 */
export function isActiveMember(status: Status | undefined) {
	return status === 'active' || status === 'on_hold'
}

const PROVIDER_NAMES: Record<string, string> = {
	dodo: 'Dodo Payments',
	creem: 'Creem',
	lemonsqueezy: 'Lemon Squeezy',
	stripe: 'Stripe',
}

/**
 * 有效会员怎么停订（#74）。core 没有停订或门户接口（`getPortalUrl` 只有声明），只能说明去哪里管：
 * 站长手动开通的不扣费；Apple 内购在系统设置里；支付平台代收的在它的付款邮件里
 */
export function subscriptionManageTextOf(provider: string | undefined, lang: UiLang = 'zh') {
	if (provider === 'manual')
		return translate(lang, 'membership.membershipWasGranted')
	if (provider === 'apple')
		return translate(lang, 'membership.subscribedThroughApple')
	const name = provider && PROVIDER_NAMES[provider]
	return name
		? translate(lang, 'membership.subscriptionBilledManage', { name })
		: translate(lang, 'membership.subscriptionBilledPayment')
}

/** 还在自动续费的订阅：注销账号不会停止扣款（core 删号时不通知支付平台），要先停订 */
export function blocksAccountDeletion(state: { status: Status, provider?: string } | null | undefined) {
	return Boolean(state && isActiveMember(state.status) && state.provider !== 'manual')
}

/** 会员页上「我的会员」一行 */
export function membershipStatusText(state: { status: Status, plan?: 'monthly' | 'yearly', currentPeriodEnd?: string }, formatDate: (date: string) => string, lang: UiLang = 'zh') {
	const plan = state.plan ? translate(lang, 'membership.planInParens', { plan: planLabel(state.plan, lang) }) : ''
	const until = state.currentPeriodEnd ? formatDate(state.currentPeriodEnd) : undefined
	switch (state.status) {
		case 'active':
			return until ? translate(lang, 'membership.activeMembershipCurrent', { plan, until }) : translate(lang, 'membership.activeMembership', { plan })
		case 'on_hold':
			return until ? translate(lang, 'membership.renewalFailedPleaseUpdate', { until }) : translate(lang, 'membership.renewalFailedPlease')
		case 'cancelled':
			return translate(lang, 'membership.membershipEnded', { plan })
		case 'expired':
			return translate(lang, 'membership.membershipExpired')
		default:
			return translate(lang, 'membership.youreNotMember')
	}
}

interface OffersLike {
	enabled: boolean
	article: { enabled: boolean }
	appleIap?: { enabled: boolean }
}

/**
 * 付费墙卡片的标题与说明，按站长开放的购买方式分支。`offers` 没取到时（服务端渲染）只说是预览。
 * `canBuyArticle`：这一篇能单篇解锁（全局开了、这篇也允许）
 */
export function paywallCopyOf(offers: OffersLike | undefined, canBuyArticle: boolean, previewBlocks?: number, lang: UiLang = 'zh') {
	const preview = previewBlocks ? translate(lang, 'membership.abovePreviewParagraphs', { n: previewBlocks }) : translate(lang, 'membership.abovePreview')
	if (!offers)
		return { title: translate(lang, 'membership.membersOnlyContent'), text: preview }
	if (offers.enabled) {
		return {
			title: translate(lang, 'membership.forMembers'),
			text: canBuyArticle
				? translate(lang, 'membership.becomeMemberReadAll', { preview })
				: translate(lang, 'membership.becomeMemberRead', { preview }),
		}
	}
	if (canBuyArticle)
		return { title: translate(lang, 'membership.membersOnlyPost'), text: translate(lang, 'membership.unlockOnceRead', { preview }) }
	if (offers.appleIap?.enabled)
		return { title: translate(lang, 'membership.membersOnlyPost'), text: translate(lang, 'membership.subscribeAppRead', { preview }) }
	return { title: translate(lang, 'membership.membersOnlyPost'), text: translate(lang, 'membership.postCantPurchased', { preview }) }
}

/** 会员页的介绍：只说开放了的方式；什么都没开放时不显示 */
export function membershipIntroOf(offers: OffersLike, lang: UiLang = 'zh') {
	if (offers.enabled && offers.article.enabled)
		return translate(lang, 'membership.membersCanReadEvery')
	if (offers.enabled)
		return translate(lang, 'membership.membersCanRead')
	if (offers.article.enabled)
		return translate(lang, 'membership.canUnlockMembers')
	if (offers.appleIap?.enabled)
		return translate(lang, 'membership.subscribeMembershipApp')
	return undefined
}

/** 付费文章清单里每篇对当前读者的状态 */
export function entitlementLabel(reason: Reason, lang: UiLang = 'zh') {
	switch (reason) {
		case 'locked':
			return translate(lang, 'membership.locked')
		case 'free-window':
			return translate(lang, 'membership.freeLimitedTime')
		case 'purchase':
			return translate(lang, 'membership.unlocked')
		case 'membership':
			return translate(lang, 'membership.members')
		case 'owner':
			return translate(lang, 'common.owner')
		default:
			return translate(lang, 'membership.public')
	}
}
