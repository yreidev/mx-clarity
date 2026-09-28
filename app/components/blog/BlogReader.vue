<script setup lang="ts">
/**
 * 侧栏底部：读者登录后显示头像与昵称，点开是会员页（会员状态、退出）。没登录不显示。
 * 站长另有「控制台」（admin 的地址，照「在后台编辑」的算法）。
 * 读者状态只在浏览器里取（全站共用一份，见 useMxReader）
 */
const t = useT()
const { reader, refresh } = useMxReader()
const { data: theme } = useMxTheme()
const { data: site } = useMxSite()
onMounted(() => {
	if (!reader.value)
		refresh()
})
const me = computed(() => reader.value?.reader)
const consoleUrl = computed(() => (me.value?.isOwner ? adminHomeUrlOf({ adminUrl: theme.value.adminUrl, webUrl: site.value.webUrl }) : undefined))
</script>

<template>
<UtilLink v-if="me" to="/membership" class="blog-reader" :title="t('site.membershipStatusSign', { name: me.name })">
	<img v-if="me.avatar" class="blog-reader-avatar" :src="me.avatar" alt="" referrerpolicy="no-referrer">
	<Icon v-else name="tabler:user-circle" class="blog-reader-avatar" />
	<span class="blog-reader-name">{{ me.name }}</span>
	<span v-if="me.isOwner" class="blog-reader-badge">{{ t('common.owner') }}</span>
</UtilLink>
<a v-if="consoleUrl" :href="consoleUrl" class="blog-reader blog-reader-console" target="_blank" rel="noopener">
	<Icon name="tabler:layout-dashboard" class="blog-reader-avatar" />
	<span class="blog-reader-name">{{ t('site.dashboard') }}</span>
</a>
</template>

<style scoped>
.blog-reader {
	display: flex;
	align-items: center;
	gap: 0.5em;
	padding: 0.3em 0.6em;
	border-radius: 0.5em;
	font-size: 0.9em;

	&:hover {
		background-color: var(--c-bg-soft);
	}
}

.blog-reader-avatar {
	width: 1.6em;
	height: 1.6em;
	border-radius: 50%;
	object-fit: cover;
}

.blog-reader-name {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.blog-reader-badge {
	padding: 0 0.3em;
	border-radius: 0.3em;
	background-color: var(--c-primary-soft);
	font-size: 0.8em;
	color: var(--c-primary);
}
</style>
