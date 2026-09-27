<script setup lang="ts">
import type { ArticlePaywall, MembershipOffers } from '~/types/membership'

/**
 * 付费文章锁定时接在预览下面的卡片，购买按钮见 `MembershipActions`。
 * 读者身份与方案只在浏览器里取，服务端渲染出的是卡片的骨架
 */
const props = defineProps<{
	paywall: ArticlePaywall
	postId: string
	/** 付完回来、正在等到账 */
	confirming?: boolean
}>()

// 读者身份全站共用一份（评论区里退出，这里跟着变）
const { reader, refresh: refreshReader } = useMxReader()
const offers = ref<MembershipOffers>()
const failed = ref(false)
const t = useT()
const uiLang = useUiLang()

async function load() {
	failed.value = false
	try {
		[, offers.value] = await Promise.all([refreshReader(), fetchMembershipOffers()])
	}
	catch {
		failed.value = true
	}
}
onMounted(load)

const canBuyArticle = computed(() => Boolean(props.paywall.purchasable && offers.value?.article.enabled))
// 标题与说明按站长开放的购买方式来写；方案没取到时（服务端渲染）只说是预览
const copy = computed(() => paywallCopyOf(offers.value, canBuyArticle.value, props.paywall.previewBlocks, uiLang.value))
</script>

<template>
<section class="paywall" aria-labelledby="paywall-title">
	<Icon name="tabler:lock" class="paywall-icon" />
	<h2 id="paywall-title" class="paywall-title">
		{{ copy.title }}
	</h2>

	<p v-if="confirming" class="paywall-text" role="status">
		<Icon name="tabler:loader-2" class="paywall-spin" /> {{ t('membership.confirmingPaymentFull') }}
	</p>
	<template v-else>
		<p class="paywall-text">
			{{ copy.text }}
		</p>

		<p v-if="failed" class="paywall-text">
			{{ t('membership.purchaseOptionsCouldnt') }}
			<button type="button" class="paywall-link" @click="load">
				{{ t('common.retry') }}
			</button>
		</p>
		<MembershipActions
			v-else-if="reader && offers"
			:reader
			:offers
			:article="paywall.purchasable ? { postId, price: paywall.price } : undefined"
			@changed="load"
		/>

		<UtilLink to="/membership" class="paywall-more">
			{{ t('membership.aboutMembershipMembers') }} <Icon name="tabler:arrow-right" />
		</UtilLink>
	</template>
</section>
</template>

<style lang="scss" scoped>
.paywall {
	display: grid;
	justify-items: center;
	gap: 0.8em;
	margin: 1rem;
	padding: 2em 1.5em;
	border: 1px solid var(--c-border);
	border-radius: 1em;
	background-color: var(--c-bg-2);
	text-align: center;

	@media (max-width: $breakpoint-mobile) {
		margin: 1rem 0.5rem;
		padding: 1.5em 1em;
	}
}

.paywall-icon {
	font-size: 2.2em;
	color: var(--c-primary);
}

.paywall-title {
	font-size: 1.2em;
}

.paywall-text {
	max-width: 32em;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.paywall-link {
	color: var(--c-primary);

	&:hover {
		text-decoration: underline;
	}
}

.paywall-more {
	display: inline-flex;
	align-items: center;
	gap: 0.2em;
	font-size: 0.85em;
	color: var(--c-text-3);

	&:hover {
		color: var(--c-primary);
	}
}

.paywall-spin {
	vertical-align: -0.15em;
	animation: paywall-spin 1s linear infinite;
}

@keyframes paywall-spin {
	to { transform: rotate(1turn); }
}

@media (prefers-reduced-motion: reduce) {
	.paywall-spin {
		animation: none;
	}
}
</style>
