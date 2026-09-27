import { likeContent, reactionErrorOf, voteThinking } from '~/utils/mx/reactions'

/**
 * 点赞与碎碎念的赞 / 踩，浏览器直连 core，core 按读者的 IP 去重。
 *
 * 「我赞过没有、投的哪一票」由浏览器自己记在 `localStorage`：详情里的 `isLiked` 会被 core 的缓存串给别人，不能信。
 * 挂载之后才读存储（`initOnMounted`），服务端渲染出的都是「没赞过」，水合前后一致
 */

const MAX_REMEMBERED = 500

// 每个组件各建一个：没有组件实例时 `initOnMounted` 不起作用，会在水合前就读存储。同一页面的多个实例由 VueUse 互相同步
function likedStore() {
	return useLocalStorage<string[]>('mx-clarity:liked', [], { initOnMounted: true })
}

function votesStore() {
	return useLocalStorage<Record<string, 'up' | 'down'>>('mx-clarity:thinking-votes', {}, { initOnMounted: true })
}

export function useLike(kind: 'post' | 'note', id: MaybeRefOrGetter<string>, count: MaybeRefOrGetter<number | undefined>) {
	const t = useT()
	const core = useCoreClient()
	const liked = likedStore()
	const key = computed(() => `${kind}:${toValue(id)}`)
	const isLiked = computed(() => liked.value.includes(key.value))
	/** 这次会话里点赞计入了几次；赞数本身来自页面数据 */
	const added = ref(0)
	// 页面数据里的赞数可能是缓存的旧值（core 15 秒），自己赞过的至少是 1，免得刷新后看着像没赞上
	const shownCount = computed(() => Math.max((toValue(count) ?? 0) + added.value, isLiked.value ? 1 : 0))
	const pending = ref(false)
	const message = ref('')

	async function like() {
		if (isLiked.value || pending.value)
			return
		pending.value = true
		message.value = ''
		try {
			const { counted } = await callCore(() => likeContent(core(), kind, toValue(id)), reactionErrorOf)
			if (counted)
				added.value++
			liked.value = [...liked.value.filter(k => k !== key.value), key.value].slice(-MAX_REMEMBERED)
		}
		catch (error) {
			message.value = t(serverErrorMessage(error, t('common.couldntDoRight')))
		}
		finally {
			pending.value = false
		}
	}

	return { isLiked, shownCount, pending, message, like }
}

export function useThinkingVote(id: MaybeRefOrGetter<string>, initial: { up: MaybeRefOrGetter<number>, down: MaybeRefOrGetter<number> }) {
	const t = useT()
	const core = useCoreClient()
	const votes = votesStore()
	const mine = computed(() => votes.value[toValue(id)])
	/**
	 * 投过票之后以服务端返回的计数为准。之前用页面数据，它可能是缓存的旧值（本站 60 秒 + core 15 秒），
	 * 本人投的那一项至少是 1，免得刷新后看着像票丢了
	 */
	const counts = ref<{ up: number, down: number }>()
	const up = computed(() => counts.value?.up ?? Math.max(toValue(initial.up), mine.value === 'up' ? 1 : 0))
	const down = computed(() => counts.value?.down ?? Math.max(toValue(initial.down), mine.value === 'down' ? 1 : 0))
	const pending = ref(false)
	const message = ref('')

	async function vote(attitude: 'up' | 'down') {
		if (pending.value)
			return
		pending.value = true
		message.value = ''
		try {
			const result = await callCore(() => voteThinking(core(), toValue(id), attitude), reactionErrorOf)
			counts.value = { up: result.up, down: result.down }
			const next = { ...votes.value }
			if (result.attitude)
				next[toValue(id)] = result.attitude
			else
				delete next[toValue(id)]
			const keys = Object.keys(next)
			votes.value = keys.length > MAX_REMEMBERED ? Object.fromEntries(keys.slice(-MAX_REMEMBERED).map(k => [k, next[k]!])) : next
		}
		catch (error) {
			message.value = t(serverErrorMessage(error, t('common.couldntDoRight')))
		}
		finally {
			pending.value = false
		}
	}

	return { mine, up, down, pending, message, vote }
}
