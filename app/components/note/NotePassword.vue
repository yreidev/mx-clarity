<script setup lang="ts">
/**
 * 加密日记的密码框。密码只 POST 给本站的 server 路由，不进网址。
 * 带上这一页的语言（前缀版的语言，看原文时是 original），解锁后的正文与页面是同一版
 */
const props = defineProps<{
	nid: number
	original?: boolean
}>()

const emit = defineEmits<{
	unlocked: [detail: import('~/types/note').NoteDetail]
}>()

const t = useT()
const routeLang = useRouteLang()
const password = ref('')
const pending = ref(false)
const message = ref('')

async function submit() {
	if (!password.value || pending.value)
		return
	pending.value = true
	message.value = ''
	try {
		const detail = await $fetch<import('~/types/note').NoteDetail>(`/api/mx/notes/${props.nid}/unlock`, {
			method: 'POST',
			query: { lang: props.original ? ORIGINAL_LANG : routeLang.value },
			body: { password: password.value },
		})
		emit('unlocked', detail)
	}
	catch (error) {
		const status = (error as { statusCode?: number }).statusCode
		message.value = status === 403 ? t('note.wrongPasswordTry') : t('note.couldntVerifyRight')
	}
	finally {
		pending.value = false
	}
}
</script>

<template>
<form class="note-password" @submit.prevent="submit">
	<Icon name="tabler:lock" class="lock-icon" />
	<p>{{ t('note.diaryEntryPassword') }}</p>
	<label>
		<span class="visually-hidden">{{ t('note.password') }}</span>
		<input
			v-model="password"
			type="password"
			autocomplete="off"
			:placeholder="t('note.enterPassword')"
			:disabled="pending"
		>
	</label>
	<ZButton type="submit" :text="pending ? t('note.verifying') : t('note.open')" :disabled="pending || !password" />
	<p v-if="message" class="note-password-message" role="alert">
		{{ message }}
	</p>
</form>
</template>

<style scoped>
.note-password {
	display: grid;
	justify-items: center;
	gap: 0.8em;
	margin: 3rem 1rem;
	text-align: center;

	input {
		width: min(16em, 80vw);
		padding: 0.4em 0.8em;
		border: 1px solid var(--c-border);
		border-radius: 0.5em;
		background-color: var(--c-bg-2);
		color: var(--c-text);
	}
}

.lock-icon {
	font-size: 2.5em;
	color: var(--c-text-3);
}

.note-password-message {
	font-size: 0.9em;
	color: var(--c-danger, #D33);
}

.visually-hidden {
	position: absolute;
	overflow: hidden;
	width: 1px;
	height: 1px;
	clip-path: inset(50%);
	white-space: nowrap;
}
</style>
