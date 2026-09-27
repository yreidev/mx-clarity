<script setup lang="ts">
import type { SubscribeType } from '~/types/subscribe'
import { parseSubscribe, subscribe, subscribeErrorOf } from '~/utils/mx/subscribe'

/**
 * 邮件订阅框：页脚的「邮件订阅」与正文后面的「订阅」各带一个。`open(type)` 只勾那一类，不给就全勾。
 * core 只在发布新文章、新日记时发信。浏览器直连 core
 */
const core = useCoreClient()
const { data: status } = useSubscribeStatus()
const t = useT()
const titleId = useId()
const LABELS = computed<Record<SubscribeType, string>>(() => ({ post_c: t('subscribe.newPosts'), note_c: t('subscribe.newDiaryEntries') }))
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const email = ref('')
const picked = ref<SubscribeType[]>([])
const pending = ref(false)
const message = ref<{ kind: 'ok' | 'error', text: string }>()

function open(type?: SubscribeType) {
	const types = status.value?.types ?? []
	picked.value = type && types.includes(type) ? [type] : [...types]
	message.value = undefined
	dialog.value?.showModal()
}

async function submit() {
	if (pending.value || !email.value.trim() || !picked.value.length)
		return
	pending.value = true
	message.value = undefined
	try {
		const request = parseSubscribe({ email: email.value.trim(), types: picked.value }, status.value?.types)
		if (typeof request === 'string')
			refuse(400, request)
		await callCore(() => subscribe(core(), request.email, request.types), subscribeErrorOf)
		message.value = { kind: 'ok', text: t('subscribe.youreSubscribedTheres') }
		email.value = ''
	}
	catch (error) {
		message.value = { kind: 'error', text: serverErrorMessage(error, t('subscribe.couldntSubscribePlease')) }
	}
	finally {
		pending.value = false
	}
}

defineExpose({ open })
</script>

<template>
<dialog ref="dialog" class="subscribe-dialog" :aria-labelledby="titleId" @click.self="dialog?.close()">
	<form class="subscribe" @submit.prevent="submit">
		<h2 :id="titleId">
			{{ t('subscribe.emailSubscription') }}
		</h2>
		<p class="subscribe-note">
			{{ t('subscribe.getEmailWhenever') }}
		</p>
		<div class="subscribe-types" role="group" :aria-label="t('subscribe.whatSubscribe')">
			<label v-for="item in status?.types" :key="item">
				<input v-model="picked" type="checkbox" :value="item"> {{ LABELS[item] }}
			</label>
		</div>
		<input v-model="email" type="email" required maxlength="50" :placeholder="t('common.email')" :aria-label="t('common.email')" autocomplete="email">
		<p v-if="message" class="subscribe-message" :class="message.kind" :role="message.kind === 'error' ? 'alert' : 'status'">
			{{ t(message.text) }}
		</p>
		<div class="subscribe-actions">
			<button type="button" @click="dialog?.close()">
				{{ t('common.close') }}
			</button>
			<ZButton type="submit" primary :text="pending ? '…' : t('subscribe.subscribe')" :disabled="pending || !picked.length" />
		</div>
	</form>
</dialog>
</template>

<style lang="scss" scoped>
.subscribe-dialog {
	width: min(22rem, calc(100vw - 2rem));
	// 全局重置把外边距清成了 0，原生对话框靠 `margin: auto` 居中
	margin: auto;
	padding: 1.2rem;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	box-shadow: 0 1em 3em #0003;
	background-color: var(--c-bg);
	// 字号会跟着挂载处继承（页脚小一号），这里定死，放在哪都一样大
	font-size: 1rem;
	color: var(--c-text);

	&::backdrop {
		background-color: #0004;
	}

	h2 {
		margin: 0;
		font-size: 1.1em;
	}

	input[type="email"] {
		min-width: 0;
		padding: 0.4em 0.6em;
		border: 1px solid var(--c-border);
		border-radius: 0.5em;
		background-color: var(--c-bg-2);
		font: inherit;
		color: var(--c-text);
	}
}

.subscribe {
	display: grid;
	gap: 0.8em;
}

.subscribe-note {
	margin: 0;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.subscribe-types {
	display: flex;
	gap: 1em;

	label {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		cursor: pointer;
	}
}

.subscribe-message {
	margin: 0;
	font-size: 0.9em;
	color: var(--c-primary);

	&.error {
		color: var(--c-error);
	}
}

.subscribe-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.5em;

	> button {
		padding: 0.3em 0.6em;
		border-radius: 0.5em;
		color: var(--c-text-2);

		&:hover {
			background-color: var(--c-bg-soft);
		}
	}

	> .z-button {
		margin: 0;
	}
}
</style>
