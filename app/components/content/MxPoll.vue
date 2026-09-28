<script setup lang="ts">
import type { PollState } from '~/types/poll'

/**
 * 正文里的投票（Lexical 的 poll）。服务端渲染出问题与选项（不开 JS 也看得到），浏览器里进入视口时取状态。
 * 单选是单选框、多选是复选框，点「投票」才提交：投了不能改、也不能撤回，不做点一下就投。
 * 结果按站长设的「投后可见 / 截止后可见 / 始终」显示；百分比是选这一项的人占参与人数的比例
 */
const props = defineProps<{
	pollId: string
	question?: string
	mode?: 'single' | 'multiple'
	/** 选项 `[{ id, label }]` 的 JSON 字符串（服务端校验过） */
	options?: string
	closeAt?: string
	showResults?: 'always' | 'after-vote' | 'after-close'
}>()

const t = useT()
const core = useCoreClient()
const locale = useUiLocale()
const OPTION_ID = /^o_[\da-z]{1,62}$/i
const options = computed<{ id: string, label: string }[]>(() => {
	try {
		const parsed = JSON.parse(props.options ?? '[]')
		return Array.isArray(parsed) ? parsed.filter(option => typeof option?.id === 'string' && OPTION_ID.test(option.id) && typeof option?.label === 'string') : []
	}
	catch {
		return []
	}
})
const multiple = computed(() => props.mode === 'multiple')
const state = ref<PollState>()
const failed = ref(false)
const picked = ref<string[]>([])
const pending = ref(false)
const message = ref('')
const root = useTemplateRef('root')

const { stop } = useIntersectionObserver(root, async ([entry]) => {
	if (!entry?.isIntersecting)
		return
	stop()
	const result = await fetchPollState(core, props.pollId)
	if (result)
		state.value = result
	else
		failed.value = true
}, { rootMargin: '200px' })

const showResults = computed(() => pollShowsResults(props.showResults, state.value))
const canVote = computed(() => Boolean(state.value?.canVote) && !pending.value)
const timeZone = useSiteTimeZone()
const closeText = computed(() => {
	if (!props.closeAt || !Number.isFinite(Date.parse(props.closeAt)))
		return ''
	return t('content.ends', { time: toZonedLocaleString(new Date(props.closeAt).toISOString(), timeZone.value, 'full', locale.value) })
})

function toggle(id: string) {
	if (!multiple.value) {
		picked.value = [id]
		return
	}
	picked.value = picked.value.includes(id) ? picked.value.filter(item => item !== id) : [...picked.value, id]
}

function percentOf(id: string) {
	const total = state.value?.totalVotes ?? 0
	return total ? Math.round((state.value?.tallies[id] ?? 0) / total * 100) : 0
}

async function submit() {
	if (!canVote.value || !picked.value.length)
		return
	pending.value = true
	message.value = ''
	try {
		const result = await votePoll(core, props.pollId, picked.value)
		state.value = result
		message.value = t(result.error ?? t('content.voteRecordedThanks'))
	}
	catch (error) {
		message.value = t(serverErrorMessage(error, t('content.voteDidntGo')))
	}
	finally {
		pending.value = false
	}
}
</script>

<template>
<form ref="root" class="mx-poll-card" @submit.prevent="submit">
	<fieldset :disabled="!canVote">
		<legend>{{ question || t('content.vote') }}</legend>
		<p class="mx-poll-mode">
			{{ multiple ? t('content.multipleChoice') : t('content.singleChoice') }}{{ closeText ? ` · ${closeText}` : '' }}{{ state?.closed ? ` · ${t('content.ended')}` : '' }}
		</p>
		<ul>
			<li v-for="option in options" :key="option.id" :class="{ mine: state?.userVote.includes(option.id) }">
				<label>
					<input
						:type="multiple ? 'checkbox' : 'radio'"
						:name="pollId"
						:value="option.id"
						:checked="picked.includes(option.id) || state?.userVote.includes(option.id)"
						@change="toggle(option.id)"
					>
					<span class="mx-poll-label">{{ option.label }}</span>
					<span v-if="showResults" class="mx-poll-percent">{{ percentOf(option.id) }}%</span>
				</label>
				<span v-if="showResults" class="mx-poll-bar" :style="{ width: `${percentOf(option.id)}%` }" aria-hidden="true" />
			</li>
		</ul>
	</fieldset>
	<div class="mx-poll-footer" aria-live="polite">
		<span v-if="failed">{{ t('content.couldntLoadPoll') }}</span>
		<span v-else-if="!state">{{ t('common.loading') }}</span>
		<span v-else>
			{{ t('content.participants', { n: state.totalVotes }) }}{{ showResults ? '' : ` · ${t('content.resultsWillShown')}` }}{{ state.userVote.length ? ` · ${t('content.youveVoted')}` : '' }}
		</span>
		<span v-if="message" class="mx-poll-message">{{ message }}</span>
		<ZButton v-if="state?.canVote" type="submit" primary :text="pending ? t('common.submitting') : t('content.vote')" :disabled="pending || !picked.length" />
	</div>
</form>
</template>

<style scoped>
.mx-poll-card {
	margin: 1.5em 0;
	padding: 1em 1.2em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;

	fieldset {
		margin: 0;
		padding: 0;
		border: none;
	}

	legend {
		font-weight: 600;
	}

	ul {
		display: grid;
		gap: 0.4em;
		margin: 0.6em 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
		overflow: hidden;
		border-radius: 0.5em;
		background-color: var(--c-bg-2);

		&.mine {
			outline: 1px solid var(--c-primary);
		}
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.5em;
		position: relative;
		padding: 0.4em 0.7em;
		cursor: pointer;
		z-index: 1;
	}
}

.mx-poll-mode {
	margin: 0.2em 0 0;
	font-size: 0.85em;
	color: var(--c-text-3);
}

.mx-poll-label {
	flex-grow: 1;
	overflow-wrap: anywhere;
}

.mx-poll-percent {
	font-size: 0.85em;
	font-variant-numeric: tabular-nums;
	color: var(--c-text-2);
}

.mx-poll-bar {
	position: absolute;
	inset: 0 auto 0 0;
	background-color: var(--c-primary-soft);
	transition: width 0.4s;

	@media (prefers-reduced-motion: reduce) {
		transition: none;
	}
}

.mx-poll-footer {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.5em 1em;
	margin-top: 0.8em;
	font-size: 0.85em;
	color: var(--c-text-2);

	> .z-button {
		margin: 0 0 0 auto;
	}
}

.mx-poll-message {
	color: var(--c-primary);
}
</style>
