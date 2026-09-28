<script setup lang="ts">
import type { OwnerStatus } from '~/types/live'
import { msg } from '~~/shared/utils/i18n'
import { ownerStatusErrorOf, parseOwnerStatusInput, writeOwnerStatus } from '~/utils/mx/companion'

/**
 * 站长设置状态：表情、一句话、有效期（数字 + 分钟 / 小时 / 天），也能清除。
 * 浏览器直连 core，写主题配置 `ownerStatus.fn` 那个云函数（POST 设置、DELETE 清除，core 要站长会话）
 */
const props = defineProps<{
	current: OwnerStatus | null
}>()

const emit = defineEmits<{
	saved: []
}>()

const t = useT()
const core = useCoreClient()
const { data: theme } = useMxTheme()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const EMOJIS = ['☕', '💻', '📖', '🎧', '🏃', '😴', '🍜', '✈️', '🎮', '🤒']
const emoji = ref('')
const desc = ref('')
const amount = ref(1)
const UNITS = computed(() => [
	{ value: 60, label: t('site.minutes', { n: amount.value }) },
	{ value: 3600, label: t('site.hours', { n: amount.value }) },
	{ value: 86_400, label: t('site.days', { n: amount.value }) },
])
const unit = ref(3600)
const pending = ref(false)
const error = ref('')

function open() {
	emoji.value = props.current?.emoji ?? '☕'
	desc.value = props.current?.desc ?? ''
	amount.value = 1
	unit.value = 3600
	error.value = ''
	dialog.value?.showModal()
}

async function submit(clear: boolean) {
	if (pending.value)
		return
	pending.value = true
	error.value = ''
	try {
		const fn = theme.value.ownerStatus.fn
		if (!fn)
			refuse(404, msg('site.themeConfigDoesnt'))
		const input = clear ? undefined : parseOwnerStatusInput({ emoji: emoji.value, desc: desc.value, ttl: Math.round(amount.value * unit.value) })
		if (typeof input === 'string')
			refuse(400, input)
		await callCore(() => writeOwnerStatus(core(), fn, input), ownerStatusErrorOf)
		dialog.value?.close()
		emit('saved')
	}
	catch (err) {
		error.value = t(serverErrorMessage(err, t('site.couldntUpdateStatus')))
	}
	finally {
		pending.value = false
	}
}

defineExpose({ open })
</script>

<template>
<dialog ref="dialog" class="owner-status-dialog" aria-labelledby="owner-status-title" @click.self="dialog?.close()">
	<form method="dialog" @submit.prevent="submit(false)">
		<h2 id="owner-status-title">
			{{ t('site.setStatus') }}
		</h2>
		<div class="owner-status-emojis" role="group" :aria-label="t('common.emoji')">
			<button
				v-for="item in EMOJIS"
				:key="item"
				type="button"
				:aria-pressed="emoji === item"
				@click="emoji = item"
			>
				{{ item }}
			</button>
			<input v-model.trim="emoji" maxlength="8" :aria-label="t('site.typeOwnEmoji')" class="owner-status-emoji-input">
		</div>
		<input v-model.trim="desc" maxlength="60" required :placeholder="t('site.whatUp')" :aria-label="t('site.statusMessage')">
		<div class="owner-status-ttl">
			<span>{{ t('site.expiresIn') }}</span>
			<input v-model.number="amount" type="number" min="1" max="720" required :aria-label="t('site.expiresIn')">
			<select v-model.number="unit" :aria-label="t('site.unit')">
				<option v-for="item in UNITS" :key="item.value" :value="item.value">
					{{ item.label }}
				</option>
			</select>
		</div>
		<p v-if="error" class="owner-status-error" role="alert">
			{{ error }}
		</p>
		<div class="owner-status-actions">
			<button v-if="current" type="button" class="owner-status-clear" :disabled="pending" @click="submit(true)">
				{{ t('site.clear') }}
			</button>
			<span />
			<button type="button" :disabled="pending" @click="dialog?.close()">
				{{ t('common.cancel') }}
			</button>
			<ZButton type="submit" primary :text="pending ? t('common.saving') : t('common.save')" :disabled="pending || !emoji || !desc" />
		</div>
	</form>
</dialog>
</template>

<style scoped>
.owner-status-dialog {
	width: min(24rem, calc(100vw - 2rem));
	/* 全局重置把外边距清成了 0，原生对话框靠 `margin: auto` 居中 */
	margin: auto;
	padding: 1.2rem;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	box-shadow: 0 1em 3em #0003;
	background-color: var(--c-bg);
	color: var(--c-text);

	&::backdrop {
		background-color: #0004;
	}

	form {
		display: grid;
		gap: 0.8em;
	}

	h2 {
		margin: 0;
		font-size: 1.1em;
	}

	input, select {
		min-width: 0;
		padding: 0.4em 0.6em;
		border: 1px solid var(--c-border);
		border-radius: 0.5em;
		background-color: var(--c-bg-2);
		font: inherit;
		color: var(--c-text);
	}
}

.owner-status-emojis {
	display: flex;
	flex-wrap: wrap;
	gap: 0.3em;

	> button {
		width: 2em;
		height: 2em;
		border-radius: 0.5em;

		&[aria-pressed="true"] {
			background-color: var(--c-primary-soft);
		}
	}
}

.owner-status-emoji-input {
	width: 4em;
}

.owner-status-ttl {
	display: flex;
	align-items: center;
	gap: 0.5em;

	> input {
		width: 5em;
	}
}

.owner-status-error {
	margin: 0;
	font-size: 0.85em;
	color: var(--c-error);
}

.owner-status-actions {
	display: flex;
	align-items: center;
	gap: 0.5em;

	> span {
		flex: 1;
	}

	> button {
		padding: 0.3em 0.6em;
		border-radius: 0.5em;
		color: var(--c-text-2);

		&:hover {
			background-color: var(--c-bg-2);
		}

		&.owner-status-clear {
			color: var(--c-error);
		}
	}
}
</style>
