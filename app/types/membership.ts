/**
 * 付费文章与会员。只有文章有付费墙，日记、独立页没有。
 */

/** 谁能读这篇：core 的 `EntitlementService` 算好的结果，主题只照着显示 */
export type EntitlementReason = 'public' | 'owner' | 'free-window' | 'purchase' | 'membership' | 'locked'

export type MembershipPlan = 'monthly' | 'yearly'

/** 价格。`amount` 是最小货币单位（美元即美分），与 Dodo 一致 */
export interface Price {
	amount: number
	currency: string
}

export interface PlanPrice extends Price {
	interval: 'day' | 'week' | 'month' | 'year'
	intervalCount: number
}

/** 文章详情里的付费墙（`$meta.paywall`），付费文章才有 */
export interface ArticlePaywall {
	/** 为真时正文只有 core 截好的预览 */
	locked: boolean
	reason: EntitlementReason
	/** 限时公开到这个时间 */
	freeUntil?: string
	/** 锁定时预览了前几块 */
	previewBlocks?: number
	/** 能不能单篇解锁 */
	purchasable: boolean
	/** 单篇价格；core 向支付平台查不到时没有 */
	price?: Price
}

/** 会员方案与单篇解锁（`GET /membership/plans`），全站一样 */
export interface MembershipOffers {
	/** 站长开了会员 */
	enabled: boolean
	plans: { plan: MembershipPlan, price?: PlanPrice }[]
	article: { enabled: boolean, price?: Price }
	/** 站长开了 Apple 内购（只能在 App 里买） */
	appleIap: { enabled: boolean }
}

/** 限时公开期间本人到期后还能不能读 */
export interface ArticleAccess {
	/** 有效会员（`active`、`on_hold`） */
	member: boolean
	/** 买过这篇 */
	purchased: boolean
}

export type MembershipStatus = 'none' | 'active' | 'on_hold' | 'cancelled' | 'expired'

/** 会员是经哪里开通的（core 的 `provider`） */
export type MembershipProvider = 'dodo' | 'creem' | 'lemonsqueezy' | 'stripe' | 'manual' | 'apple'

export interface MembershipState {
	status: MembershipStatus
	plan?: MembershipPlan
	/** 当期到期时间 */
	currentPeriodEnd?: string
	/** 认不出的不带 */
	provider?: MembershipProvider
}

/** 付费文章清单里的一篇（`GET /membership/archive`），`entitlement` 是当前读者自己的 */
export interface PremiumArticle {
	id: string
	title: string
	path: string
	date: string
	entitlement: EntitlementReason
	freeUntil?: string
}

/** 会员页的个人部分：没登录时 `membership` 为空，付费文章清单照样有 */
export interface MembershipMe {
	membership: MembershipState | null
	articles: PremiumArticle[]
}

export type CheckoutRequest
	= | { kind: 'membership', plan: MembershipPlan, returnPath: string }
		| { kind: 'article', postId: string, returnPath: string }

export interface CheckoutResult {
	/** 支付平台的托管收银台，只会是 https */
	checkoutUrl: string
}
