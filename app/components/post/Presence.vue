<script setup lang="ts">
/**
 * 阅读位置：同一篇的其他读者读到哪了。只在宽屏显示，正文右侧一条细轨道：挨得近的人合成一组
 * （一个人的组显示首字，多人的显示人数），悬停或聚焦一组列出名单；自己的位置是一小段主题色横线。
 *
 * 自己的位置由浏览器直接报给 core（`/activity/presence/update`），最多 2 秒一次；
 * 名字取登录读者的名字或评论表单记下的游客昵称，都没有就是匿名。标识是本标签页随机生成的，不是会话 id（core 会把标识广播给同一篇的读者）
 */
const props = defineProps<{
	/** 正文元素的选择器，按它算读到了百分之几 */
	target?: string
}>()

interface Reader {
	position: number
	name: string
}

const uiLang = useUiLang()
const t = useT()
const live = useMxLive()
const { reader } = useMxReader()
const readers = ref(new Map<string, Reader>())
const others = computed(() => [...readers.value].map(([identity, item]) => ({ identity, ...item })))
const selfPosition = ref(0)
const article = ref<HTMLElement | null>(null)
const { right, top, height } = useElementBounding(article)

useLiveMessages((message) => {
	const next = new Map(readers.value)
	switch (message.type) {
		case 'presence-list':
			next.clear()
			for (const item of message.items)
				next.set(item.identity, { position: item.position, name: item.name })
			break
		case 'presence':
			next.set(message.identity, { position: message.position, name: message.name })
			break
		case 'presence-leave':
			next.delete(message.identity)
			break
		default:
			return
	}
	readers.value = next
})

function guestName() {
	try {
		const saved = JSON.parse(localStorage.getItem('mx-clarity:comment-guest') ?? '{}') as { author?: unknown }
		return typeof saved.author === 'string' ? saved.author.trim() : ''
	}
	catch {
		return ''
	}
}

/** 正文读到了百分之几：正文顶到视口顶是 0，正文底到视口底是 100 */
function readPercent() {
	const el = article.value
	if (!el)
		return 0
	const rect = el.getBoundingClientRect()
	const scrollable = rect.height - innerHeight
	if (scrollable <= 0)
		return rect.top < innerHeight ? 100 : 0
	return Math.round(Math.min(100, Math.max(0, -rect.top / scrollable * 100)))
}

function report() {
	selfPosition.value = readPercent()
	live.presence(selfPosition.value, reader.value?.reader?.name || guestName() || undefined)
}

const onScroll = useThrottleFn(report, 1000, true)
useEventListener('scroll', onScroll, { passive: true })

onMounted(() => {
	article.value = document.querySelector<HTMLElement>(props.target ?? '#main-content article.article')
	report()
})

/** 圆点的颜色由标识决定，同一人在各处一样 */
function hueOf(identity: string) {
	let hash = 0
	for (const char of identity)
		hash = (hash * 31 + char.codePointAt(0)!) % 360
	return hash
}

const railHeight = computed(() => Math.max(0, Math.min(top.value + height.value, innerHeight - 96) - Math.max(top.value, 96)))
const groups = computed(() => groupPresence(others.value, railHeight.value))

const railStyle = computed(() => ({
	left: `${right.value + 12}px`,
	top: `${Math.max(top.value, 96)}px`,
	height: `${Math.max(0, Math.min(top.value + height.value, innerHeight - 96) - Math.max(top.value, 96))}px`,
}))
</script>

<template>
<aside v-if="others.length && article" class="presence-rail" :style="railStyle" :aria-label="t('post.otherPeopleReading', { n: others.length })">
	<span class="presence-self" :style="{ top: `${selfPosition}%` }" :title="t('post.you', { percent: selfPosition })" aria-hidden="true" />
	<ul>
		<li
			v-for="group in groups"
			:key="group.key"
			class="presence-dot"
			:class="{ many: group.members.length > 1 }"
			:style="{ 'top': `${group.position}%`, '--hue': hueOf(group.key) }"
			tabindex="0"
			:aria-label="presenceLabelOf(group, uiLang).join(t('post.commaSeparator'))"
		>
			<span aria-hidden="true">{{ group.members.length > 1 ? group.members.length : [...group.members[0]!.name][0] }}</span>
			<span class="presence-pop" role="tooltip">
				<span v-for="line in presenceLabelOf(group, uiLang)" :key="line">{{ line }}</span>
			</span>
		</li>
	</ul>
</aside>
</template>

<style lang="scss" scoped>
.presence-rail {
	position: fixed;
	width: 2px;
	border-radius: 1px;
	background-color: var(--c-border);
	z-index: 10;

	@media (max-width: $breakpoint-widescreen) {
		display: none;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
}

.presence-dot {
	display: grid;
	place-items: center;
	position: absolute;
	left: 50%;
	width: 1.4rem;
	height: 1.4rem;
	border: 2px solid var(--c-bg);
	border-radius: 50%;
	background-color: hsl(var(--hue) 55% 55%);
	font-size: 0.7rem;
	line-height: 1;
	color: #FFF;
	transform: translate(-50%, -50%);
	transition: top 0.6s ease;
	cursor: default;

	@media (prefers-reduced-motion: reduce) {
		transition: none;
	}
}

.presence-dot.many {
	width: 1.6rem;
	height: 1.6rem;
	font-variant-numeric: tabular-nums;
}

.presence-self {
	position: absolute;
	left: 50%;
	width: 0.9rem;
	height: 2px;
	border-radius: 1px;
	background-color: var(--c-primary);
	transform: translate(-50%, -50%);
	transition: top 0.6s ease;
	pointer-events: none;

	@media (prefers-reduced-motion: reduce) {
		transition: none;
	}
}

.presence-pop {
	display: none;
	position: absolute;
	top: 50%;
	right: calc(100% + 0.5rem);
	width: max-content;
	max-width: 14rem;
	padding: 0.4em 0.6em;
	border: 1px solid var(--c-border);
	border-radius: 0.5em;
	box-shadow: 0 0.3em 1em #0002;
	background-color: var(--c-bg);
	font-size: 0.75rem;
	line-height: 1.5;
	color: var(--c-text);
	transform: translateY(-50%);
	z-index: 1;

	> span {
		display: block;
		white-space: nowrap;
	}
}

.presence-dot:hover .presence-pop, .presence-dot:focus-visible .presence-pop {
	display: block;
}
</style>
