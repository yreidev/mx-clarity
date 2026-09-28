<script setup lang="ts">
/**
 * 语言建议（与 Yohaku 一样）：浏览器里、进站 1.5 秒后，按 `navigator.languages` 找读者最想要、站点又开了的语言（中文也算），
 * 与当前页面的语言不同就在左下角提示一条，文案用那个语言写；10 秒后自己收起（鼠标或焦点停在上面时不收）。
 * 选过语言（cookie `mx-lang`）的不提示；「暂不」本标签页内不再提示，「不再提示」对这个语言永久不提示（记在本机）。
 * 服务端对不带前缀的页面已经按浏览器语言跳过一次，这里主要照顾不跳转的文章、日记详情
 */
const route = useRoute()
const routeLang = useRouteLang()
const { data: theme } = useMxTheme()
const cookie = useCookie<string | undefined>(LANG_COOKIE, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

const DISMISSED_KEY = 'mx-clarity:lang-suggestion-dismissed'
const SNOOZED_KEY = 'mx-clarity:lang-suggestion-snoozed'

const suggested = ref<string>()
const copy = computed(() => (suggested.value ? LANG_SUGGESTION_COPY[suggested.value] : undefined))
const target = computed(() => {
	const path = delocalizePath(route.fullPath)
	return !suggested.value || suggested.value === SITE_LANG_CODE ? path : localePath(path, suggested.value)
})

function dismissedLangs(): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
		return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
	}
	catch {
		return []
	}
}

let hideTimer: ReturnType<typeof setTimeout> | undefined
function pauseHide() {
	clearTimeout(hideTimer)
}
function scheduleHide() {
	clearTimeout(hideTimer)
	hideTimer = setTimeout(() => suggested.value = undefined, 10_000)
}

let appear: ReturnType<typeof setTimeout> | undefined
onMounted(() => {
	if (cookie.value)
		return
	try {
		if (sessionStorage.getItem(SNOOZED_KEY))
			return
	}
	catch {}
	appear = setTimeout(() => {
		const wanted = negotiateLang(navigator.languages.join(','), theme.value.i18n.languages)
		if (!wanted || wanted === (routeLang.value ?? SITE_LANG_CODE) || !LANG_SUGGESTION_COPY[wanted] || dismissedLangs().includes(wanted))
			return
		suggested.value = wanted
		scheduleHide()
	}, 1500)
})
onBeforeUnmount(() => {
	clearTimeout(appear)
	clearTimeout(hideTimer)
})

function accept() {
	cookie.value = suggested.value
	suggested.value = undefined
}

function later() {
	try {
		sessionStorage.setItem(SNOOZED_KEY, '1')
	}
	catch {}
	suggested.value = undefined
}

function never() {
	try {
		localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissedLangs(), suggested.value])]))
	}
	catch {}
	suggested.value = undefined
}
</script>

<template>
<Transition name="float-in">
	<aside
		v-if="copy && suggested"
		class="lang-suggestion"
		:lang="suggested === 'zh' ? 'zh-CN' : suggested"
		:aria-label="copy.message"
		@mouseenter="pauseHide"
		@mouseleave="scheduleHide"
		@focusin="pauseHide"
		@focusout="scheduleHide"
	>
		<Icon name="tabler:language" />
		<p>{{ copy.message }}</p>
		<div class="lang-suggestion-actions">
			<NuxtLink :to="target" :hreflang="suggested" @click="accept">
				{{ copy.accept }}
			</NuxtLink>
			<button type="button" @click="later">
				{{ copy.later }}
			</button>
			<button type="button" @click="never">
				{{ copy.never }}
			</button>
		</div>
	</aside>
</Transition>
</template>

<style scoped>
.lang-suggestion {
	display: grid;
	grid-template-columns: auto 1fr;
	align-items: start;
	gap: 0.3em 0.6em;
	padding: 0.7em 0.9em;
	border: 1px solid var(--c-border);
	border-radius: 0.8em;
	box-shadow: var(--box-shadow-2, 0 0.5em 1.5em #0002);
	background-color: var(--c-bg);
	font-size: 0.9em;

	> .iconify {
		margin-top: 0.2em;
		color: var(--c-primary);
	}

	> p {
		margin: 0;
	}
}

.lang-suggestion-actions {
	display: flex;
	flex-wrap: wrap;
	grid-column: 2;
	gap: 0.3em 0.9em;

	> a {
		font-weight: 600;
		color: var(--c-primary);
	}

	> button {
		color: var(--c-text-2);

		&:hover {
			color: var(--c-text-1);
		}
	}
}
</style>
