<script setup lang="ts">
const t = useT()
const appConfig = useAppConfig()
const { data: theme } = useMxTheme()
const copyright = useFooterCopyright()
// 实时在线人数，浏览器连上 core 的实时连接之后才有。鼠标移上去弹出此刻有人在读的内容，移开收起；
// 触屏与键盘点按钮开关，点别处或按 Esc 收起
const { online } = useMxLive()
const readingOpen = ref(false)
const onlineBox = useTemplateRef('online-box')
let closeTimer: ReturnType<typeof setTimeout> | undefined
function hoverReading(event: PointerEvent, open: boolean) {
	if (event.pointerType !== 'mouse')
		return
	clearTimeout(closeTimer)
	// 移开时稍等一下再收：鼠标从按钮挪到弹出层要经过两者之间的空隙
	if (open)
		readingOpen.value = true
	else
		closeTimer = setTimeout(() => readingOpen.value = false, 200)
}
onClickOutside(onlineBox, () => readingOpen.value = false)
onKeyStroke('Escape', () => readingOpen.value = false)
onBeforeUnmount(() => clearTimeout(closeTimer))
// 没开会员、单篇购买、App 内购时，默认的「会员」入口点进去什么都买不了，不显示
const { data: offers } = useMxMembershipOffers()
const sellsAnything = computed(() => Boolean(offers.value && (offers.value.enabled || offers.value.article.enabled || offers.value.appleIap.enabled)))

// 主题本身与上游 blog-v3 的链接（固定带着）
const credits = computed(() => [
	{ icon: 'simple-icons:nuxt', text: t('site.themeCredit', { name: appConfig.themeCredit.name, version: appConfig.themeCredit.version }), url: appConfig.themeCredit.homepage },
	{ icon: 'tabler:git-fork', text: t('site.basedOnClarity'), url: appConfig.themeCredit.upstream },
])

// 主题配置里的链接分组，末尾加上主题本身与上游的链接；站长也建了「信息」组就放进那一组
const nav = computed(() => {
	const groups = theme.value.footer.nav
		.map(group => ({ ...group, items: group.items.filter(item => sellsAnything.value || item.url !== '/membership') }))
		.filter(group => group.items.length)
	const info = groups.find(group => group.title === '信息')
	if (info)
		info.items.push(...credits.value)
	else
		groups.push({ title: t('common.info'), items: [...credits.value] })
	return groups
})

// 站长开了邮件订阅时，「邮件订阅」接在 Atom 订阅那一组的末尾；没有 Atom 链接就放最后一组。点开是订阅框，全勾
const { data: subscribeStatus } = useSubscribeStatus()
const subscribable = computed(() => Boolean(subscribeStatus.value?.enable && subscribeStatus.value.types.length))
const subscribeGroup = computed(() => {
	const index = nav.value.findIndex(group => group.items.some(item => item.url.endsWith('atom.xml')))
	return index >= 0 ? index : nav.value.length - 1
})
const subscribeDialog = useTemplateRef('subscribe-dialog')
</script>

<template>
<footer class="blog-footer">
	<nav class="footer-nav" :aria-label="t('site.footerNavigation')">
		<div v-for="(group, groupIndex) in nav" :key="groupIndex">
			<hgroup class="text-creative" v-text="t(group.title)" />
			<menu>
				<li v-for="(item, itemIndex) in group.items" :key="itemIndex">
					<UtilLink :to="item.url">
						<Icon :name="item.icon" />
						<span class="nav-text">{{ t(item.text) }}</span>
					</UtilLink>
				</li>
				<li v-if="subscribable && groupIndex === subscribeGroup">
					<button type="button" class="footer-subscribe" aria-haspopup="dialog" @click="subscribeDialog?.open()">
						<Icon name="tabler:mail" />
						<span class="nav-text">{{ t('subscribe.emailSubscription') }}</span>
					</button>
				</li>
			</menu>
		</div>
	</nav>
	<p v-text="copyright" />
	<div
		v-if="online !== undefined"
		ref="online-box"
		class="footer-online"
		@pointerenter="hoverReading($event, true)"
		@pointerleave="hoverReading($event, false)"
	>
		<button type="button" :aria-expanded="readingOpen" aria-controls="footer-reading" @click="readingOpen = !readingOpen">
			<Icon name="tabler:users" /> {{ t('site.peopleOnline', { n: online }) }}
		</button>
		<BlogFooterReading v-if="readingOpen" id="footer-reading" />
	</div>
	<BlogSubscribeDialog v-if="subscribable" ref="subscribe-dialog" />
</footer>
</template>

<style lang="scss" scoped>
.blog-footer {
	margin: 3rem 1rem;
	font-size: 0.9em;
	color: var(--c-text-2);

	.footer-nav {
		display: flex;
		flex-wrap: wrap;
		gap: 5vw clamp(2rem, 5%, 5vw);
		padding-block: 3rem;

		hgroup {
			margin: 0.5em;
		}

		a, .footer-subscribe {
			display: flex;
			align-items: center;
			gap: 0.3em;
			width: fit-content;
			padding: 0.3em 0.5em;
			border-radius: 0.5em;
			font-size: 0.9em;
			transition: background-color 0.2s, color 0.1s;

			&:hover {
				background-color: var(--c-bg-soft);
				color: var(--c-text);
			}
		}
	}

	p {
		margin: 0.5em;
	}

	.footer-online {
		position: relative;
		width: fit-content;
		margin: 0.5em;
		font-size: 0.85em;
		color: var(--c-text-3);

		> button {
			display: flex;
			align-items: center;
			gap: 0.3em;
			color: inherit;

			&:hover, &[aria-expanded="true"] {
				color: var(--c-text-2);
			}
		}
	}
}
</style>
