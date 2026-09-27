<script setup lang="ts">
import type { MembershipState } from '~/types/membership'

/**
 * 会员页底部的账号：怎么停订（#74）、注销账号（#72）。站长不显示。
 * 注销前先看会员：还在自动续费就拦下（core 删号时不通知支付平台，扣款不会停）；
 * 确认写在页面里（二次确认），然后浏览器直接同源请求 Better Auth 的 `delete-user`
 */
const props = defineProps<{
	membership?: MembershipState | null
}>()

const emit = defineEmits<{
	/** 注销成功，请上层刷新读者状态 */
	deleted: []
}>()

const t = useT()
const uiLang = useUiLang()
const confirming = ref(false)
const pending = ref(false)
const message = ref('')

const blocked = computed(() => blocksAccountDeletion(props.membership))
const manageText = computed(() => props.membership && isActiveMember(props.membership.status) ? subscriptionManageTextOf(props.membership.provider, uiLang.value) : undefined)

async function remove() {
	if (pending.value)
		return
	pending.value = true
	message.value = ''
	const result = await deleteAccount()
	pending.value = false
	if (result === 'deleted') {
		confirming.value = false
		emit('deleted')
		return
	}
	message.value = result === 'stale-session'
		? t('membership.securityPleaseSign')
		: t('membership.couldntDeleteAccount')
}
</script>

<template>
<section class="account" aria-labelledby="account-title">
	<h2 id="account-title" class="account-title">
		{{ t('membership.account') }}
	</h2>

	<p v-if="manageText" class="account-text">
		<Icon name="tabler:receipt" /> {{ manageText }}
	</p>

	<p v-if="blocked" class="account-text">
		{{ t('membership.membershipStillSet') }}
	</p>
	<template v-else-if="confirming">
		<div class="account-confirm" role="group" aria-labelledby="account-confirm-title">
			<p id="account-confirm-title" class="account-confirm-title">
				{{ t('membership.deleteYourAccount') }}
			</p>
			<ul>
				<li>{{ t('membership.membershipPurchasedPosts') }}</li>
				<li>{{ t('membership.commentsWontDeleted') }}</li>
				<li>{{ t('membership.cantUndone') }}</li>
			</ul>
			<div class="account-actions">
				<ZButton :text="pending ? t('membership.deleting') : t('membership.deleteAccount2')" :disabled="pending" class="danger" @click="remove" />
				<ZButton :text="t('common.cancel2')" :disabled="pending" @click="confirming = false" />
			</div>
		</div>
	</template>
	<p v-else class="account-text">
		<button type="button" class="account-link" @click="confirming = true">
			{{ t('membership.deleteAccount') }}
		</button>
	</p>

	<p v-if="message" class="account-message" role="alert">
		{{ message }}
	</p>
</section>
</template>

<style lang="scss" scoped>
.account {
	display: grid;
	gap: 0.6em;
}

.account-title {
	font-size: 1.2em;
}

.account-text {
	font-size: 0.9em;
	color: var(--c-text-2);
}

.account-link {
	text-decoration: underline;
	color: var(--c-text-3);

	&:hover {
		color: var(--c-error);
	}
}

.account-confirm {
	display: grid;
	gap: 0.5em;
	padding: 0.8em 1em;
	border: 1px solid var(--c-error-soft);
	border-radius: 0.6em;
	font-size: 0.9em;

	ul {
		padding-inline-start: 1.5em;
		color: var(--c-text-2);
		list-style: revert;
	}
}

.account-confirm-title {
	font-weight: 600;
}

.account-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 0.6em;

	> .z-button {
		margin: 0;
	}

	> .danger {
		color: var(--c-error);
	}
}

.account-message {
	font-size: 0.9em;
	color: var(--c-error);
}
</style>
