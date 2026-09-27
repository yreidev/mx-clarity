<script setup lang="ts">
import type { ModalEmits, ModalProps } from '#modals'
import type { SearchHit } from '~/types/search'

const props = defineProps<ModalProps>()

defineEmits<ModalEmits>()

// 搜索交给 core：原先的 minisearch 要在浏览器里下载全站正文建索引，换成 mx 之后没有这份数据
const searchStore = useSearchStore()
const searchInput = ref<HTMLInputElement>()
const t = useT()

const { word, debouncedWord } = storeToRefs(searchStore)
const core = useCoreClient()
const result = ref<SearchHit[]>([])
const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
let requestId = 0

watch(debouncedWord, async (keyword) => {
	const query = keyword.trim().slice(0, 50)
	const id = ++requestId
	if (!query) {
		result.value = []
		status.value = 'idle'
		return
	}
	status.value = 'pending'
	try {
		const page = await searchSite(core, query)
		// 输入更快时，旧请求的结果晚到也不覆盖新的
		if (id !== requestId)
			return
		result.value = page.items
		status.value = 'success'
	}
	catch {
		if (id === requestId)
			status.value = 'error'
	}
}, { immediate: true })

const isKeyboardMode = ref(false)
const listResult = useTemplateRef('list-result')

const activeIndex = ref(0)
const activeItem = computed(() => listResult.value?.children[activeIndex.value] as HTMLLinkElement | undefined)

whenever(() => props.open, focusInput)

watch(debouncedWord, () => {
	activeIndex.value = 0
})

useEventListener('mousemove', () => isKeyboardMode.value = false)
useEventListener('keydown', () => isKeyboardMode.value = true)

async function focusInput(allSelect = false) {
	await nextTick()
	searchInput.value?.focus()
	if (allSelect)
		searchInput.value?.select()
}

function updateActiveIndex(index: number, isKeyboard = false) {
	focusInput()
	if (index < 0 || index >= result.value?.length)
		return
	activeIndex.value = index
	if (isKeyboard)
		isKeyboardMode.value = true
	if (activeItem.value && isKeyboardMode.value) {
		activeItem.value.scrollIntoView({ block: 'nearest' })
	}
}

function openActiveItem() {
	// 触发 vue-router 点击事件
	activeItem.value?.click()
}
</script>

<template>
<Transition name="float-in">
	<div v-if="open" class="blog-search">
		<form class="input" @submit.prevent>
			<Icon v-show="false" name="line-md:loading-alt-loop" />
			<Icon :name="status === 'pending' ? 'line-md:loading-alt-loop' : 'tabler:search'" />

			<!-- 方向键切换搜索结果不应只在搜索框内触发 -->
			<input
				ref="searchInput"
				v-model="word"
				type="search"
				incremental
				class="search-input"
				:placeholder="t('search.typeSearch')"
				@keydown.up.prevent
				@keydown.down.prevent
			>
		</form>

		<TransitionGroup name="expand">
			<div v-if="debouncedWord && status === 'success' && !result.length" class="no-result">
				{{ t('search.noResults') }}
			</div>
			<div v-else-if="status === 'error'" class="no-result">
				{{ t('search.searchTemporarilyUnavailable') }}
			</div>

			<menu
				v-if="result.length"
				ref="list-result"
				:key="result.length < 5 ? result.length : result[0]?.id"
				class="scrollcheck-y search-result"
			>
				<PopoverSearchItem
					v-for="(item, itemIndex) in result"
					:key="item.id"
					v-bind="item"
					:query="debouncedWord"
					:class="{ active: activeIndex === itemIndex }"
					@mousemove="updateActiveIndex(itemIndex)"
				/>
			</menu>

			<div v-if="result.length" class="tip" @click="searchInput?.focus()">
				<Key code="ArrowUp" prevent @press="updateActiveIndex(activeIndex - 1, true)" />
				<Key code="ArrowDown" prevent @press="updateActiveIndex(activeIndex + 1, true)" />
				{{ t('search.navigate') }}&emsp;
				<Key code="Enter" icon @press="openActiveItem" />
				{{ t('search.select') }}&emsp;
				<Key code="Escape" :icon="false" @press="$emit('close')" />
				{{ t('common.close') }}
				<UtilLink :to="`/search?q=${encodeURIComponent(debouncedWord.trim().slice(0, 50))}`" class="more" @click="$emit('close')">
					{{ t('search.viewSearchPage') }} <Icon name="tabler:arrow-right" />
				</UtilLink>
			</div>
		</TransitionGroup>
	</div>
</Transition>
</template>

<style lang="scss" scoped>
.blog-search {
	--float-distance: 20vh;

	contain: paint;
	position: fixed;
	inset: 0;
	width: 90%;
	height: fit-content;
	max-width: $breakpoint-mobile;
	margin: auto;
	border: 1px solid var(--c-primary);
	border-radius: 1em;
	box-shadow: var(--box-shadow-2), var(--box-shadow-3);
	outline: 0.2em solid var(--c-primary-soft);
	background-color: var(--ld-bg-card);
}

.input {
	display: flex;
	align-items: center;
	gap: 1em;
	position: relative;
	padding: 0 1em;

	> .search-input {
		width: 100%;
		padding: 1em 0;
		outline: none;
	}
}

.no-result {
	// expand 时不要设置 padding
	max-height: 5em;
	line-height: 5em;
	text-align: center;
	color: var(--c-text-3);
	transition: all 0.5s;
}

.search-result {
	max-height: 75vh;
	max-height: 75dvh;
	transition: all 0.5s;
	scroll-padding: var(--fadeout-height);
}

.search-item {
	transition: background-color 0.1s, opacity 0.2s;
}

.tip {
	max-height: 1rem;
	margin: 0 1em 0.5rem;
	font-size: 0.8em;
	text-align: center;
	color: var(--c-text-3);
	transition: all 0.5s;

	> .more {
		margin-inline-start: 1em;
		white-space: nowrap;
		color: var(--c-primary);
	}
}

.expand-enter-active,
.expand-leave-active {
	transition: all 0.5s;
}

.expand-enter-from,
.expand-leave-to {
	opacity: 0;
	max-height: 0;
}
</style>
