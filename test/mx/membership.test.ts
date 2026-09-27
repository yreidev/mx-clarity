import { describe, expect, it } from 'vitest'
import { classifyMxError } from '../../app/utils/mx/errors'
import { checkoutErrorOf, isSitePath, loadArticleAccess, loadMembershipMe, loadOffers, membershipStateFrom, offersFrom, parseCheckoutRequest, paywallFrom, premiumArticleFrom, startCheckout, UnsafeCheckoutUrlError } from '../../app/utils/mx/membership'
import { renderPostBody } from '../../app/utils/mx/render'
import { entitlementLabel, formatPlanPrice, formatPrice, freeWindowTipOf, isActiveMember, membershipIntroOf, membershipStatusText, paywallBadgeOf, paywallCopyOf, remainingText } from '../../shared/utils/membership'
import { clientWith, fixture, jsonResponse } from './helpers'

/** 详情夹具走一遍 api-client：`$meta` 由它挂上，字段已转成 camelCase */
async function postFrom(name: string) {
	const { client } = clientWith(() => jsonResponse(fixture(name)))
	return client.post.getPost('x', 'y')
}

function errorResponse(status: number, code: string) {
	return jsonResponse({ error: { code, message: 'irrelevant' } }, { status })
}

describe('详情的付费墙', () => {
	it('锁定（游客看付费文章）：预览了前 3 块、能单篇解锁；支付没配好时查不到价格', async () => {
		const post = await postFrom('post-premium-locked')
		expect(paywallFrom(post.$meta)).toEqual({
			locked: true,
			reason: 'locked',
			freeUntil: '2026-09-23T05:15:22Z',
			previewBlocks: 3,
			purchasable: true,
			price: undefined,
		})
	})

	it('买过这篇的读者：没锁、理由是 purchase', async () => {
		expect(paywallFrom((await postFrom('post-premium-purchased')).$meta)).toMatchObject({ locked: false, reason: 'purchase', previewBlocks: undefined })
	})

	it('限时公开期内：游客也能读全文，理由是 free-window', async () => {
		expect(paywallFrom((await postFrom('post-premium-free-window')).$meta)).toMatchObject({ locked: false, reason: 'free-window', freeUntil: '2026-09-26T05:15:22Z' })
	})

	it('不是付费文章时没有付费墙', async () => {
		expect(paywallFrom((await postFrom('post-lexical-media')).$meta)).toBeUndefined()
		expect(paywallFrom(undefined)).toBeUndefined()
		expect(paywallFrom({ paywall: { locked: 'yes' } })).toBeUndefined()
	})

	it('锁定时正文由 core 截断：同一篇的预览比全文短得多，主题照常渲染', async () => {
		const locked = await renderPostBody(await postFrom('post-premium-locked'))
		const full = await renderPostBody(await postFrom('post-premium-purchased'))
		expect(locked.source).toBe('lexical')
		expect(locked.body.children.length).toBeLessThan(full.body.children.length)
		expect(JSON.stringify(locked.body).length * 3).toBeLessThan(JSON.stringify(full.body).length)
	})

	it('认不出的理由按 locked 推；价格、预览块数不合要求的丢掉', () => {
		expect(paywallFrom({ paywall: { locked: true, entitlement: { reason: 'vip' } } })?.reason).toBe('locked')
		expect(paywallFrom({ paywall: { locked: false, entitlement: { reason: 'vip' } } })?.reason).toBe('public')
		for (const price of [{ amount: -1, currency: 'USD' }, { amount: 2.5, currency: 'USD' }, { amount: 299, currency: 'usd' }, { amount: '299', currency: 'USD' }]) {
			const paywall = paywallFrom({ paywall: { locked: true, previewBlocks: -1, freeUntil: 'someday', purchase: { enabled: true, price } } })
			expect(paywall?.price, JSON.stringify(price)).toBeUndefined()
			expect(paywall?.previewBlocks).toBeUndefined()
			expect(paywall?.freeUntil).toBeUndefined()
		}
		expect(paywallFrom({ paywall: { locked: true, purchase: { enabled: true, price: { amount: 299, currency: 'USD' } } } })?.price).toEqual({ amount: 299, currency: 'USD' })
	})
})

describe('方案与价格', () => {
	it('夹具：开了会员、月付年付都有、能单篇解锁，都没有价格', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('membership-plans')))
		expect(await loadOffers(client)).toEqual({
			enabled: true,
			plans: [{ plan: 'monthly', price: undefined }, { plan: 'yearly', price: undefined }],
			article: { enabled: true, price: undefined },
			appleIap: { enabled: false },
		})
		expect(new URL(requests[0]!.url).pathname).toBe('/api/v3/membership/plans')
	})

	it('有价格时带上；认不出的方案、重复的方案、坏的周期丢掉（构造数据）', () => {
		const offers = offersFrom({
			enabled: true,
			plans: [
				{ plan: 'monthly', pricing: { amount: 499, currency: 'USD', interval: 'month', intervalCount: 1 } },
				{ plan: 'monthly', pricing: { amount: 1, currency: 'USD', interval: 'month', intervalCount: 1 } },
				{ plan: 'yearly', pricing: { amount: 4999, currency: 'USD', interval: 'fortnight', intervalCount: 1 } },
				{ plan: 'lifetime', pricing: { amount: 1, currency: 'USD', interval: 'year', intervalCount: 1 } },
			],
			articlePurchase: { enabled: true, price: { amount: 299, currency: 'USD' } },
		})
		expect(offers.plans).toEqual([
			{ plan: 'monthly', price: { amount: 499, currency: 'USD', interval: 'month', intervalCount: 1 } },
			{ plan: 'yearly', price: undefined },
		])
		expect(offers.article).toEqual({ enabled: true, price: { amount: 299, currency: 'USD' } })
		expect(offersFrom(undefined)).toEqual({ enabled: false, plans: [], article: { enabled: false, price: undefined }, appleIap: { enabled: false } })
		// 会员没开时 core 照样返回 Apple 内购与单篇解锁的开关
		expect(offersFrom({ enabled: false, plans: [], appleIap: { enabled: true }, articlePurchase: { enabled: false } }).appleIap).toEqual({ enabled: true })
	})
})

describe('会员状态与付费文章清单', () => {
	it('夹具：会员有效，只取状态、方案、到期时间、开通方式', () => {
		const { data } = fixture('membership-status')
		expect(membershipStateFrom({ status: data.status, plan: data.plan, provider: data.provider, currentPeriodEnd: data.current_period_end }))
			.toEqual({ status: 'active', plan: 'monthly', currentPeriodEnd: '2026-10-24T05:15:22.000Z', provider: 'manual' })
		// 认不出的开通方式不带
		expect(membershipStateFrom({ status: 'active', provider: 'paypal' })).toEqual({ status: 'active', plan: undefined, currentPeriodEnd: undefined, provider: undefined })
		expect(membershipStateFrom({ status: 'none' })).toEqual({ status: 'none' })
		expect(membershipStateFrom({ status: 'vip', plan: 'monthly' })).toEqual({ status: 'none' })
	})

	it('夹具：清单里每篇是本人的解锁状态，地址按分类 slug 拼', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('membership-archive')))
		const { articles } = await loadMembershipMe(client, false)
		expect(articles).toEqual([
			{ id: '186000000000000102', title: '示例：分步骤的长文', path: '/posts/essay/sample-step-by-step', date: '2022-06-21T13:15:00.000Z', entitlement: 'membership', freeUntil: '2026-09-23T05:15:22Z' },
			expect.objectContaining({ path: '/posts/tools/sample-list-code', entitlement: 'free-window' }),
		])
	})

	it('id、分类、日期不对的条目丢掉', () => {
		const good = { id: '1', slug: 's', category: { slug: 'c' }, createdAt: '2026-01-01T00:00:00Z', entitlement: 'locked' }
		expect(premiumArticleFrom(good)).toMatchObject({ path: '/posts/c/s' })
		for (const bad of [{ ...good, id: '../1' }, { ...good, category: {} }, { ...good, createdAt: 'x' }, { ...good, slug: '' }])
			expect(premiumArticleFrom(bad), JSON.stringify(bad)).toBeUndefined()
		expect(premiumArticleFrom({ ...good, entitlement: 'vip' })?.entitlement).toBe('locked')
	})

	it('没登录不问状态；会话过期（401）当作没登录；别的错误照常抛', async () => {
		const guest = clientWith(() => jsonResponse(fixture('membership-archive')))
		expect((await loadMembershipMe(guest.client, false)).membership).toBeNull()
		expect(guest.requests.map(r => new URL(r.url).pathname)).toEqual(['/api/v3/membership/archive'])

		const route = (status: number) => (request: Request) => new URL(request.url).pathname.endsWith('/status')
			? errorResponse(status, status === 401 ? 'AUTH_NOT_LOGGED_IN' : 'INTERNAL_ERROR')
			: jsonResponse(fixture('membership-archive'))
		expect((await loadMembershipMe(clientWith(route(401)).client, true)).membership).toBeNull()
		await expect(loadMembershipMe(clientWith(route(500)).client, true)).rejects.toThrow()

		const member = clientWith(request => new URL(request.url).pathname.endsWith('/status') ? jsonResponse(fixture('membership-status')) : jsonResponse(fixture('membership-archive')))
		expect((await loadMembershipMe(member.client, true)).membership).toMatchObject({ status: 'active', plan: 'monthly' })
	})
})

describe('结账', () => {
	it('返回地址只收站内路径', () => {
		for (const good of ['/', '/posts/tech/a', '/membership?from=paywall'])
			expect(isSitePath(good), good).toBe(true)
		for (const bad of ['//evil.test/x', 'https://evil.test', 'posts/a', '/\\evil.test', `/a${String.fromCharCode(10)}b`, `/${'a'.repeat(600)}`, undefined, 42])
			expect(isSitePath(bad), String(bad)).toBe(false)
	})

	it('请求只认两种：成为会员（月付 / 年付）、单篇解锁（Snowflake id）', () => {
		expect(parseCheckoutRequest({ kind: 'membership', plan: 'yearly', returnPath: '/membership' })).toEqual({ kind: 'membership', plan: 'yearly', returnPath: '/membership' })
		expect(parseCheckoutRequest({ kind: 'article', postId: '186000000000000102', returnPath: '/posts/a/b', extra: 1 })).toEqual({ kind: 'article', postId: '186000000000000102', returnPath: '/posts/a/b' })
		for (const bad of [
			{ kind: 'membership', plan: 'lifetime', returnPath: '/' },
			{ kind: 'article', postId: 'abc', returnPath: '/' },
			{ kind: 'article', postId: '1', returnPath: 'https://evil.test' },
			{ kind: 'membership', plan: 'monthly' },
			{ kind: 'refund', returnPath: '/' },
			undefined,
		])
			expect(typeof parseCheckoutRequest(bad), JSON.stringify(bad)).toBe('string')
	})

	it('发给 core 的路径与请求体；收银台地址原样返回', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { checkout_url: 'https://test.checkout.example.test/session/1' } }))
		expect(await startCheckout(client, { kind: 'membership', plan: 'monthly', returnPath: '/membership' })).toEqual({ checkoutUrl: 'https://test.checkout.example.test/session/1' })
		await startCheckout(client, { kind: 'article', postId: '186000000000000102', returnPath: '/posts/essay/sample-step-by-step' })
		expect(requests.map(r => [r.method, new URL(r.url).pathname])).toEqual([
			['POST', '/api/v3/membership/checkout'],
			['POST', '/api/v3/membership/article-checkout'],
		])
		expect(await requests[0]!.json()).toEqual({ plan: 'monthly', returnPath: '/membership' })
		expect(await requests[1]!.json()).toEqual({ postId: '186000000000000102', returnPath: '/posts/essay/sample-step-by-step' })
	})

	it('收银台地址不是 https 时不给', async () => {
		for (const url of ['http://pay.example.test', 'javascript:alert(1)', '', undefined]) {
			const { client } = clientWith(() => jsonResponse({ data: { checkout_url: url } }))
			await expect(startCheckout(client, { kind: 'membership', plan: 'monthly', returnPath: '/' }), String(url)).rejects.toBeInstanceOf(UnsafeCheckoutUrlError)
		}
	})

	it('报错只给固定文案；状态码按 core 的实际返回', async () => {
		const failureOf = async (status: number, code: string) => {
			const { client } = clientWith(() => errorResponse(status, code))
			return classifyMxError(await startCheckout(client, { kind: 'membership', plan: 'monthly', returnPath: '/' }).catch(error => error))
		}
		expect(checkoutErrorOf(await failureOf(409, 'MEMBERSHIP_ALREADY_ACTIVE'))).toEqual({ statusCode: 409, message: '你已经是会员了，刷新页面就能读全文' })
		expect(checkoutErrorOf(await failureOf(409, 'ARTICLE_ALREADY_PURCHASED')).statusCode).toBe(409)
		expect(checkoutErrorOf(await failureOf(400, 'ARTICLE_NOT_PURCHASABLE')).message).toBe('这篇文章不能单篇解锁')
		expect(checkoutErrorOf(await failureOf(401, 'AUTH_NOT_LOGGED_IN'))).toEqual({ statusCode: 401, message: '请先登录' })
		// 支付平台的凭据不对、连不上时 core 回 500
		expect(checkoutErrorOf(await failureOf(500, 'INTERNAL_ERROR'))).toEqual({ statusCode: 503, message: '支付服务暂时不可用，请稍后再试' })
		expect(checkoutErrorOf(await failureOf(422, 'VALIDATION_FAILED')).statusCode).toBe(400)
	})
})

describe('显示文字', () => {
	it('价格按货币的小数位换算', () => {
		expect(formatPrice({ amount: 299, currency: 'USD' })).toBe('US$2.99')
		expect(formatPrice({ amount: 990, currency: 'CNY' })).toBe('¥9.90')
		expect(formatPrice({ amount: 500, currency: 'JPY' })).toBe('JP¥500')
		expect(formatPlanPrice({ amount: 499, currency: 'USD', interval: 'month', intervalCount: 1 })).toBe('US$4.99 / 月')
		expect(formatPlanPrice({ amount: 1299, currency: 'USD', interval: 'month', intervalCount: 3 })).toBe('US$12.99 / 3 个月')
	})

	it('剩余时间粗到天、小时、分钟，过了就没有', () => {
		const now = Date.parse('2026-09-24T00:00:00Z')
		expect(remainingText('2026-09-26T12:00:00Z', now)).toBe('2 天')
		expect(remainingText('2026-09-24T03:30:00Z', now)).toBe('3 小时')
		expect(remainingText('2026-09-24T00:00:20Z', now)).toBe('1 分钟')
		expect(remainingText('2026-09-23T00:00:00Z', now)).toBeUndefined()
		expect(remainingText('someday', now)).toBeUndefined()
	})

	it('文章头部的标记：会员与公开不加', () => {
		const now = Date.parse('2026-09-24T00:00:00Z')
		// 锁定标记不分购买方式：站长可能只开了单篇解锁
		expect(paywallBadgeOf({ reason: 'locked' }, now)?.text).toBe('付费内容')
		expect(paywallBadgeOf({ reason: 'free-window', freeUntil: '2026-09-26T05:15:22Z' }, now)?.text).toBe('限时公开 · 剩 2 天')
		expect(paywallBadgeOf({ reason: 'free-window', freeUntil: '2026-09-23T00:00:00Z' }, now)?.text).toBe('限时公开')
		expect(paywallBadgeOf({ reason: 'purchase' }, now)?.text).toBe('已永久解锁')
		expect(paywallBadgeOf({ reason: 'owner' }, now)?.text).toBe('付费文章')
		expect(paywallBadgeOf({ reason: 'membership' }, now)).toBeUndefined()
		expect(paywallBadgeOf({ reason: 'public' }, now)).toBeUndefined()
		expect(entitlementLabel('membership')).toBe('会员可读')
	})

	it('限时公开期间：会员、买过的说明不受影响，悬停提示写明到期时间', () => {
		const now = Date.parse('2026-09-24T00:00:00Z')
		const paywall = { reason: 'free-window' as const, freeUntil: '2026-09-26T05:15:22Z' }
		expect(paywallBadgeOf(paywall, now, { member: true, purchased: false })?.text).toBe('限时公开 · 你是会员')
		expect(paywallBadgeOf(paywall, now, { member: false, purchased: true })?.text).toBe('限时公开 · 已买过')
		expect(paywallBadgeOf(paywall, now, { member: false, purchased: false })?.text).toBe('限时公开 · 剩 2 天')
		const date = (d: string) => `〈${d}〉`
		expect(freeWindowTipOf(paywall.freeUntil, undefined, date)).toBe('免费阅读到 〈2026-09-26T05:15:22Z〉；到期后会员和买过的读者照常可读')
		expect(freeWindowTipOf(paywall.freeUntil, { member: true, purchased: false }, date)).toContain('你是会员，到期后照常阅读')
		expect(freeWindowTipOf(undefined, { member: false, purchased: true }, date)).toBe('限时免费阅读；你买过这篇，到期后照常阅读')
	})

	it('会员状态：on_hold 仍可阅读、不能再下单；cancelled 就是结束了', () => {
		const date = (d: string) => d.slice(0, 10)
		expect(membershipStatusText({ status: 'active', plan: 'monthly', currentPeriodEnd: '2026-10-24T00:00:00Z' }, date)).toBe('会员有效（月付会员），当期到 2026-10-24')
		expect(membershipStatusText({ status: 'on_hold', plan: 'monthly', currentPeriodEnd: '2026-10-24T00:00:00Z' }, date)).toBe('续费没有成功，请尽快更新付款方式；2026-10-24 之前仍可阅读')
		expect(membershipStatusText({ status: 'cancelled', plan: 'yearly', currentPeriodEnd: '2026-10-24T00:00:00Z' }, date)).toBe('会员已结束（年付会员）')
		expect(membershipStatusText({ status: 'expired' }, date)).toBe('会员已过期')
		expect(membershipStatusText({ status: 'none' }, date)).toBe('你还不是会员')
		expect([isActiveMember('active'), isActiveMember('on_hold'), isActiveMember('cancelled'), isActiveMember(undefined)]).toEqual([true, true, false, false])
	})

	it('付费墙与会员页的文案跟着开放的购买方式走', () => {
		const offers = (enabled: boolean, article: boolean, apple = false) => ({ enabled, article: { enabled: article }, appleIap: { enabled: apple } })
		expect(paywallCopyOf(undefined, false, 3)).toEqual({ title: '付费内容', text: '以上是前 3 段的预览。' })
		expect(paywallCopyOf(offers(true, true), true, 3)).toEqual({ title: '会员专享', text: '以上是前 3 段的预览。成为会员可以阅读全部付费文章，也可以只解锁这一篇。' })
		expect(paywallCopyOf(offers(true, true), false).text).toBe('以上是预览。成为会员可以阅读全部付费文章。')
		expect(paywallCopyOf(offers(false, true), true)).toEqual({ title: '付费文章', text: '以上是预览。解锁这一篇后永久可读。' })
		expect(paywallCopyOf(offers(false, false, true), false).text).toBe('以上是预览。请在 App 内订阅会员后阅读。')
		// 单篇解锁全局开着、这一篇却不许买，会员也没开
		expect(paywallCopyOf(offers(false, true), false).text).toBe('以上是预览。这篇文章暂时无法购买。')
		expect(membershipIntroOf(offers(true, true))).toContain('单篇解锁')
		expect(membershipIntroOf(offers(true, false))).toBe('会员可以阅读全站的付费文章。')
		expect(membershipIntroOf(offers(false, true))).toBe('付费文章可以在文章末尾单篇解锁，买过的永久可读。')
		expect(membershipIntroOf(offers(false, false, true))).toBe('会员请在 App 内订阅。')
		expect(membershipIntroOf(offers(false, false))).toBeUndefined()
	})
})

describe('限时公开期间本人的权限', () => {
	it('没登录不问 core', async () => {
		const { client, requests } = clientWith(() => jsonResponse({}))
		expect(await loadArticleAccess(client, '186000000000000102', false)).toEqual({ member: false, purchased: false })
		expect(requests).toHaveLength(0)
	})

	it('登录了：会员状态与是否买过这篇；查不到当作不能', async () => {
		const { client, requests } = clientWith((req) => {
			const path = new URL(req.url).pathname
			if (path.endsWith('/membership/status'))
				return jsonResponse({ data: { status: 'on_hold', plan: 'monthly' } })
			return jsonResponse({ data: { purchased: true } })
		})
		expect(await loadArticleAccess(client, '186000000000000102', true)).toEqual({ member: true, purchased: true })
		expect(requests.map(r => new URL(r.url).pathname).sort()).toEqual(['/api/v3/membership/article-purchases/186000000000000102', '/api/v3/membership/status'])
		const failing = clientWith(() => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'x' } }, { status: 401 }))
		expect(await loadArticleAccess(failing.client, '186000000000000102', true)).toEqual({ member: false, purchased: false })
	})
})
