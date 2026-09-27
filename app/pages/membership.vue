<script setup lang="ts">
import type { MembershipMe, MembershipState } from '~/types/membership'

/**
 * 会员：方案与价格、我的会员状态、付费文章清单（每篇对我的解锁状态）。
 * 方案全站一样，服务端渲染；读者相关的部分只在浏览器里取
 */
const { data: site } = useMxSite()
const t = useT()
useSeoMeta({
	title: () => t('common.membership'),
	description: () => t('membership.membershipMembersOnly', { site: site.value.title }),
})

const { data: offers, error: offersError } = await useMxMembershipOffers()

// 读者身份全站共用一份
const { reader, refresh: refreshReader } = useMxReader()
const core = useCoreClient()
const mine = ref<MembershipMe>()
const mineFailed = ref(false)

async function loadMine() {
	mineFailed.value = false
	try {
		[, mine.value] = await Promise.all([refreshReader(), fetchMembershipMe(core)])
	}
	catch {
		mineFailed.value = true
	}
}
onMounted(loadMine)

// 付完回来（?membership=success）：会员生效前每 2 秒再查一次
const payment = usePaymentReturn({ locked: () => mine.value?.membership?.status !== 'active', refresh: loadMine })

const now = useRenderNow()
const timeZone = useSiteTimeZone()
const locale = useUiLocale()
const uiLang = useUiLang()
// 清单里最早到期的限时公开：到期后重取一次，标记跟着变
useRefreshWhenPassed(() => mine.value?.articles
	.filter(article => article.entitlement === 'free-window' && article.freeUntil)
	.map(article => article.freeUntil!)
	.toSorted((a, b) => Date.parse(a) - Date.parse(b))[0], loadMine)
const open = computed(() => offers.value && (offers.value.enabled || offers.value.article.enabled || offers.value.appleIap.enabled))
const plans = computed(() => offers.value?.enabled ? offers.value.plans : [])
const intro = computed(() => offers.value && membershipIntroOf(offers.value, uiLang.value))
const isOwner = computed(() => Boolean(reader.value?.reader?.isOwner))
const signedIn = computed(() => Boolean(reader.value?.reader))
const deleted = ref(false)

async function onDeleted() {
	deleted.value = true
	await loadMine()
}
// core 把续费失败、还在当期内的 on_hold 也算有效会员：照常能读，也不能再下单
const member = computed(() => isActiveMember(mine.value?.membership?.status))

function statusText(state: MembershipState) {
	return membershipStatusText(state, date => toZonedLocaleString(date, timeZone.value, 'date', locale.value), uiLang.value)
}

/** 清单里每篇对我的状态；限时公开期间 core 给会员的也是 free-window，会员自己到期后照样能读 */
function articleLabel(article: MembershipMe['articles'][number]) {
	if (article.entitlement === 'free-window' && member.value)
		return entitlementLabel('membership', uiLang.value)
	const left = article.entitlement === 'free-window' && article.freeUntil ? remainingText(article.freeUntil, now.value, uiLang.value) : undefined
	return left ? t('membership.freeLimitedTimeLeft', { left }) : entitlementLabel(article.entitlement, uiLang.value)
}
</script>

<template>
<div class="membership proper-height">
	<div class="mobile-only">
		<BlogHeader to="/" :suffix="t('common.membership')" tag="h1" />
	</div>

	<section class="membership-intro">
		<Icon name="tabler:crown" class="membership-icon" />
		<h2 class="membership-title text-creative">
			{{ t('common.membership') }}
		</h2>
		<p v-if="intro" class="membership-text">
			{{ intro }}
		</p>
	</section>

	<p v-if="payment === 'confirming'" class="membership-notice" role="status">
		<Icon name="tabler:loader-2" /> {{ t('membership.confirmingPayment') }}
	</p>
	<p v-else-if="payment === 'unlocked'" class="membership-notice" role="status">
		<Icon name="tabler:circle-check" /> {{ t('membership.paymentSuccessfulMembership') }}
	</p>
	<p v-else-if="payment === 'timeout'" class="membership-notice" role="status">
		<Icon name="tabler:clock" /> {{ t('membership.paymentNotConfirmed') }}
	</p>

	<p v-if="deleted" class="membership-notice" role="status">
		<Icon name="tabler:circle-check" /> {{ t('membership.accountDeleted') }}
	</p>

	<p v-if="offersError" class="membership-empty">
		{{ t('membership.membershipInfoCant') }}
	</p>
	<p v-else-if="!open" class="membership-empty">
		{{ t('membership.ownerHasntOpened') }}
	</p>
	<template v-else>
		<menu v-if="plans.length" class="membership-plans">
			<li v-for="item in plans" :key="item.plan" class="membership-plan card">
				<h3>{{ planLabel(item.plan, uiLang) }}</h3>
				<p v-if="item.price" class="membership-price">
					{{ formatPlanPrice(item.price, locale, uiLang) }}
				</p>
				<p v-else class="membership-text">
					{{ t('membership.finalPriceShown') }}
				</p>
				<p class="membership-text">
					{{ item.plan === 'monthly' ? t('membership.renewsMonthly') : t('membership.renewsYearlyCheaper') }}
				</p>
			</li>
		</menu>
		<p v-if="offers?.article.enabled" class="membership-text membership-single">
			{{ offers.article.price ? t('membership.unlockSinglePost', { price: formatPrice(offers.article.price, locale) }) : t('membership.canUnlockSingle') }}
		</p>

		<section v-if="mine?.membership && !isOwner" class="membership-mine">
			<Icon name="tabler:user-check" />
			{{ statusText(mine.membership) }}
		</section>

		<!-- 开了会员才在这里卖；只开单篇解锁时去文章末尾买，只开 Apple 内购时去 App 里订 -->
		<MembershipActions
			v-if="reader && offers && (offers.enabled || isOwner) && !member"
			:reader
			:offers
			@changed="loadMine"
		/>
		<p v-else-if="offers && !offers.enabled && offers.article.enabled && !isOwner" class="membership-text membership-single">
			{{ t('membership.pickMembersOnly') }}
		</p>
		<p v-else-if="offers && !offers.enabled && offers.appleIap.enabled && !isOwner" class="membership-text membership-single">
			{{ t('membership.pleaseSubscribeInTheApp') }}
		</p>
	</template>

	<section class="membership-articles">
		<h2 class="membership-subtitle">
			{{ t('membership.membersOnlyPosts') }}
		</h2>
		<p v-if="mineFailed" class="membership-empty">
			{{ t('membership.membersOnlyPostsCant') }}
			<button type="button" class="membership-link" @click="loadMine">
				{{ t('common.retry') }}
			</button>
		</p>
		<p v-else-if="!mine" class="membership-empty">
			{{ t('common.loading') }}
		</p>
		<p v-else-if="!mine.articles.length" class="membership-empty">
			{{ t('membership.noMembersOnly') }}
		</p>
		<menu v-else class="membership-list">
			<li v-for="article in mine.articles" :key="article.id">
				<UtilLink :to="article.path" class="membership-article">
					<span class="membership-article-title">{{ article.title }}</span>
					<span class="membership-article-meta">
						<span
							class="membership-badge"
							:class="{ open: article.entitlement !== 'locked' }"
						>
							{{ articleLabel(article) }}
						</span>
						<time :datetime="article.date">{{ toZonedLocaleString(article.date, timeZone, 'date', locale) }}</time>
					</span>
				</UtilLink>
			</li>
		</menu>
	</section>

	<template v-if="signedIn && !isOwner">
		<MembershipMyComments />
		<MembershipAccount :membership="mine?.membership" @deleted="onDeleted" />
	</template>
</div>
</template>

<style lang="scss" scoped>
.membership {
	display: grid;
	gap: 1.5rem;
	padding: 1rem;
}

.membership-intro {
	display: grid;
	justify-items: center;
	gap: 0.6em;
	margin-top: 1rem;
	text-align: center;
}

.membership-icon {
	font-size: 2.5em;
	color: var(--c-primary);
}

.membership-title {
	font-size: 1.6em;
}

.membership-text {
	font-size: 0.9em;
	color: var(--c-text-2);
}

.membership-notice {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.4em;
	padding: 0.6em 1em;
	border-radius: 0.6em;
	background-color: var(--c-primary-soft);
	font-size: 0.9em;
}

.membership-empty {
	margin: 1rem 0;
	text-align: center;
	color: var(--c-text-2);
}

.membership-plans {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(12em, 1fr));
	gap: 1em;
}

.membership-plan {
	display: grid;
	gap: 0.4em;
	padding: 1.2em;
	border-radius: 0.8em;
	text-align: center;

	h3 {
		font-size: 1.1em;
	}
}

.membership-price {
	font-size: 1.3em;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
	color: var(--c-primary);
}

.membership-single, .membership-mine {
	text-align: center;
}

.membership-mine {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 0.4em;
}

.membership-subtitle {
	margin-bottom: 0.6em;
	font-size: 1.2em;
}

.membership-list {
	display: grid;
	gap: 0.2em;
}

.membership-article {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.2em 1em;
	padding: 0.5em 0.6em;
	border-radius: 0.5em;
	transition: background-color 0.2s;

	&:hover {
		background-color: var(--c-bg-2);
	}
}

.membership-article-title {
	overflow-wrap: anywhere;
	min-width: 0;
}

.membership-article-meta {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: 0.8em;
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-2);
}

.membership-badge {
	padding: 0 0.5em;
	border-radius: 0.4em;
	background-color: var(--c-bg-2);
	color: var(--c-text-2);

	&.open {
		background-color: var(--c-primary-soft);
		color: var(--c-primary);
	}
}

.membership-link {
	color: var(--c-primary);

	&:hover {
		text-decoration: underline;
	}
}
</style>
