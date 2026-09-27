<script setup lang="ts">
import type { ReaderState } from '~/types/comment'
import type { MembershipOffers, MembershipPlan, Price } from '~/types/membership'

/**
 * 购买按钮，付费墙卡片与会员页共用。
 * 读者：成为会员（月付 / 年付），传了 `article` 时再加单篇解锁。价格查得到才显示。
 * 游客看到同样的按钮，点了再选登录方式；登录回来（15 分钟内、还在这一页）接着打开支付页面。
 * 站长看得到全部内容，不给购买按钮
 */
const props = defineProps<{
	reader: ReaderState
	offers: MembershipOffers
	/** 单篇解锁的那一篇；不传就只卖会员 */
	article?: { postId: string, price?: Price }
}>()

const emit = defineEmits<{
	/** 登录状态变了（退出、会话过期），请上层重新取读者与方案 */
	changed: []
}>()

const t = useT()
const locale = useUiLocale()
const uiLang = useUiLang()
const pending = ref<string>()
const message = ref('')
/** 游客点了要买的东西，等选登录方式 */
const chosen = ref<{ key: string, request: Parameters<typeof startMembershipCheckout>[1] }>()
const core = useCoreClient()

const me = computed(() => props.reader.reader)
const plans = computed(() => props.offers.enabled ? props.offers.plans : [])
const canBuyArticle = computed(() => Boolean(props.article && props.offers.article.enabled))
const articlePrice = computed(() => props.article?.price ?? props.offers.article.price)
const nothingForSale = computed(() => !plans.value.length && !canBuyArticle.value)
/** 「以 {name} 的身份购买」按占位切成前后两段，名字单独加粗 */
const buyingAs = computed(() => t('membership.buyingAs').split('{name}'))

async function buy(key: string, request: Parameters<typeof startMembershipCheckout>[1]) {
	if (pending.value)
		return
	pending.value = key
	message.value = ''
	try {
		await startMembershipCheckout(core, request)
	}
	catch (error) {
		message.value = t(serverErrorMessage(error, t('membership.couldntOpenPayment')))
		pending.value = undefined
		if ((error as { statusCode?: number }).statusCode === 401)
			emit('changed')
	}
}

function choose(key: string, request: Parameters<typeof startMembershipCheckout>[1]) {
	if (me.value)
		return buy(key, request)
	message.value = ''
	chosen.value = chosen.value?.key === key ? undefined : { key, request }
}

function buyPlan(plan: MembershipPlan) {
	return choose(plan, { kind: 'membership', plan })
}

function buyArticle() {
	if (props.article)
		return choose('article', { kind: 'article', postId: props.article.postId })
}

async function login(provider: string) {
	message.value = ''
	try {
		await signInWith(provider, 'purchase', chosen.value?.request)
	}
	catch {
		message.value = t('common.couldntStartSign')
	}
}

/** 登录回来：失败就说一声；成功而且登录前选好了要买的，就接着打开支付页面（方案、文章还得对得上） */
onMounted(() => {
	const back = takeLoginReturn('purchase')
	if (!back)
		return
	if (back.failed) {
		message.value = t('common.signDidntGo')
		return
	}
	const intent = back.intent
	if (!intent || !me.value || me.value.isOwner)
		return
	if (intent.kind === 'membership' && plans.value.some(item => item.plan === intent.plan))
		buy(intent.plan, intent)
	else if (intent.kind === 'article' && canBuyArticle.value && props.article?.postId === intent.postId)
		buy('article', intent)
})

async function logout() {
	await signOut().catch(() => undefined)
	emit('changed')
}
</script>

<template>
<div class="membership-actions">
	<p v-if="me?.isOwner" class="membership-actions-text">
		{{ t('membership.youreOwnerSo') }}
	</p>

	<p v-else-if="nothingForSale" class="membership-actions-text">
		{{ offers.appleIap.enabled ? t('membership.pleaseSubscribeApp') : t('membership.ownerHasntOpenedPurchases') }}
	</p>

	<template v-else-if="me || reader.providers.length">
		<div class="membership-actions-buttons">
			<ZButton
				v-for="item in plans"
				:key="item.plan"
				:primary="item.plan === 'yearly'"
				:text="pending === item.plan ? t('membership.opening') : planLabel(item.plan, uiLang)"
				:desc="item.price && formatPlanPrice(item.price, locale, uiLang)"
				:disabled="Boolean(pending)"
				:aria-pressed="me ? undefined : chosen?.key === item.plan"
				@click="buyPlan(item.plan)"
			/>
			<ZButton
				v-if="canBuyArticle"
				:text="pending === 'article' ? t('membership.opening') : t('membership.unlockPost')"
				:desc="articlePrice && t('membership.lifetimeAccess', { price: formatPrice(articlePrice, locale) })"
				:disabled="Boolean(pending)"
				:aria-pressed="me ? undefined : chosen?.key === 'article'"
				@click="buyArticle"
			/>
		</div>
		<p v-if="me" class="membership-actions-text">
			{{ buyingAs[0] }}<b>{{ me.name }}</b>{{ buyingAs[1] }}
			<button type="button" class="membership-actions-link" @click="logout">
				{{ t('common.signOut') }}
			</button>
		</p>
		<div v-else class="membership-actions-login">
			<span>{{ chosen ? t('membership.chooseHowSign') : t('membership.signBuy') }}</span>
			<button
				v-for="provider in reader.providers"
				:key="provider"
				type="button"
				class="membership-actions-provider"
				@click="login(provider)"
			>
				<Icon :name="providerMeta(provider).icon" />{{ providerMeta(provider).name }}
			</button>
		</div>
	</template>
	<p v-else class="membership-actions-text">
		{{ t('membership.siteDoesntOffer') }}
	</p>

	<p v-if="message" class="membership-actions-message" role="alert">
		{{ message }}
	</p>
</div>
</template>

<style lang="scss" scoped>
.membership-actions {
	display: grid;
	justify-items: center;
	gap: 0.8em;
}

.membership-actions-buttons {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 0.6em;

	// 间距交给 gap；ZButton 相邻时自带的左外边距会让换行后的按钮偏右
	> .z-button {
		margin: 0;
	}
}

.membership-actions-text {
	font-size: 0.9em;
	color: var(--c-text-2);
}

.membership-actions-login {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: 0.4em 0.8em;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.membership-actions-provider {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	padding: 0.2em 0.6em;
	border: 1px solid var(--c-border);
	border-radius: 0.5em;
	color: var(--c-text);

	&:hover {
		border-color: var(--c-primary);
		color: var(--c-primary);
	}
}

.membership-actions-link {
	color: var(--c-primary);

	&:hover {
		text-decoration: underline;
	}
}

.membership-actions-message {
	font-size: 0.9em;
	color: var(--c-danger, #D33);
}
</style>
