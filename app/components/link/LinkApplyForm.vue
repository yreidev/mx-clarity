<script setup lang="ts">
/**
 * 申请友链。浏览器直连 core；审核结果由站长处理，
 * 填了邮箱的会收到通知。字段上限照 core 的校验。
 */
const t = useT()
const core = useCoreClient()
const form = reactive({ author: '', name: '', url: '', avatar: '', description: '', email: '' })
const pending = ref(false)
const notice = ref<{ kind: 'error' | 'info', text: string }>()
const submitted = ref(false)

async function submit() {
	if (pending.value)
		return
	pending.value = true
	notice.value = undefined
	try {
		await applyForLink(core, { ...form })
		submitted.value = true
		notice.value = { kind: 'info', text: t('friends.requestSubmittedOnce') }
	}
	catch (error) {
		notice.value = { kind: 'error', text: t(serverErrorMessage(error, t('friends.couldntSubmitPlease'))) }
	}
	finally {
		pending.value = false
	}
}
</script>

<template>
<form class="link-apply" @submit.prevent="submit">
	<template v-if="!submitted">
		<label>
			<span>{{ t('friends.yourName') }}</span>
			<input v-model.trim="form.author" required maxlength="20" autocomplete="nickname">
		</label>
		<label>
			<span>{{ t('friends.siteName') }}</span>
			<input v-model.trim="form.name" required maxlength="20">
		</label>
		<label>
			<span>{{ t('friends.siteUrl') }}</span>
			<input v-model.trim="form.url" type="url" required maxlength="200" pattern="https://.*" placeholder="https://" autocomplete="url">
		</label>
		<label>
			<span>{{ t('friends.avatarUrlOptional') }}</span>
			<input v-model.trim="form.avatar" type="url" maxlength="200" placeholder="https://">
		</label>
		<label class="wide">
			<span>{{ t('friends.oneLineDescription') }}</span>
			<input v-model.trim="form.description" maxlength="50">
		</label>
		<label class="wide">
			<span>{{ t('friends.emailOptionalKept') }}</span>
			<input v-model.trim="form.email" type="email" maxlength="50" autocomplete="email">
		</label>
		<div class="actions">
			<ZButton type="submit" primary :text="pending ? t('common.submitting') : t('friends.submitRequest')" :disabled="pending" />
		</div>
	</template>
	<p v-if="notice" class="notice" :class="notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'">
		{{ notice.text }}
	</p>
</form>
</template>

<style scoped>
.link-apply {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(14em, 1fr));
	gap: 0.8em 1em;
	margin: 1.5rem 1rem;

	label {
		display: grid;
		gap: 0.3em;
		font-size: 0.9em;
		color: var(--c-text-2);

		&.wide {
			grid-column: 1 / -1;
		}
	}

	input {
		width: 100%;
		min-width: 0;
		padding: 0.4em 0.7em;
		border: 1px solid var(--c-border);
		border-radius: 0.5em;
		background-color: var(--c-bg-2);
		font: inherit;
		color: var(--c-text);
		transition: border-color 0.2s;

		&:focus-visible {
			border-color: var(--c-primary);
			outline: none;
		}
	}
}

.actions {
	grid-column: 1 / -1;
	text-align: end;
}

.notice {
	grid-column: 1 / -1;
	font-size: 0.9em;
	color: var(--c-text-2);

	&.error {
		color: var(--c-error);
	}
}
</style>
