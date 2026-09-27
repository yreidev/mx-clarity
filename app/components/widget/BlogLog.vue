<script setup lang="ts">
// 站点的更新日志：主题配置里的 blogLog，没填就不显示
const t = useT()
const { data: theme } = useMxTheme()
</script>

<template>
<BlogWidget v-if="theme.blogLog.length" card :title="t('site.changelog')">
	<ZDlGroup size="large" :items="theme.blogLog" />
</BlogWidget>
</template>
