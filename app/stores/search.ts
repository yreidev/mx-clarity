import { LazyPopoverSearch } from '#components'

export const useSearchStore = defineStore('search', () => {
	// 搜索框应和侧边栏状态联动
	const layoutStore = useLayoutStore()
	const modalStore = useModalStore()

	const word = ref('')
	const { text } = useTextSelection()
	// 按钮上显示的字：选中的文字，其次上次搜的词；都没有时由按钮自己显示「搜索」（按界面语言）
	const label = computed(() => text.value.trim() || word.value)

	const { open, close } = modalStore.use(() => h(LazyPopoverSearch, {
		onClose: layoutStore.close,
	}), {
		unique: true,
		duration: 200,
	})

	// 从外部调用时应该操作 layoutStore
	watch(() => layoutStore.state, (state) => {
		if (state !== 'search')
			return close()

		word.value = text.value.trim() || word.value
		open()
	})

	return {
		word,
		label,
	}
})
