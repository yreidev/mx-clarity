<script setup lang="ts">
import { packageManager, version } from '~~/package.json'
import { Icon } from '#components'
import { API_CLIENT_VERSION } from '~/utils/mx/client'

const { data: site } = useMxSite()
const { data: theme } = useMxTheme()
const { data: coreVersion } = useMxCoreVersion()
const { public: { arch, ci, nodeVersion, platform } } = useRuntimeConfig()
// 装的是哪个版本就显示哪个：Vue 与 Nuxt 的版本由 Nuxt 提供
const { versions } = useNuxtApp()
const t = useT()

const ciPlatform = computed(() => {
	const iconName = ciIcons[ci]
	if (!iconName)
		return ''

	return h('span', {}, [h(Icon, { name: iconName }), ` ${ci.split(' ')[0]}`])
})

// `packageManager` 可能带着 Corepack 写入的完整性哈希（`pnpm@12.3.4+sha512.…`），只显示版本号
const [pm, pmSpec = ''] = packageManager.split('@') as [string, string]
const pmVersion = pmSpec.split('+')[0]

const service = computed(() => ([
	...ci ? [{ label: t('site.buildPlatform'), value: ciPlatform }] : [],
	{ label: t('site.softwareLicense'), value: 'MIT' },
	{ label: t('site.contentLicense'), value: theme.value.license.abbr },
	{ label: t('site.canonicalDomain'), value: getDomain(site.value.webUrl) },
]))

const techstack = computed(() => ([
	{ label: 'Blog', value: version },
	{ label: 'Vue', value: versions.vue },
	{ label: 'Nuxt', value: versions.nuxt },
	// 取不到正在跑的 core 的版本时不显示这一行
	...coreVersion.value ? [{ label: 'mx-space', value: coreVersion.value }] : [],
	{ label: 'api-client', value: API_CLIENT_VERSION },
	{ label: 'Node', value: nodeVersion },
	{ label: pm, value: pmVersion },
	{ label: 'OS', value: platform },
	{ label: 'Arch', value: arch },
]))

const expand = ref(false)
</script>

<template>
<BlogWidget card grayscale :title="t('site.techInfo')">
	<ZDlGroup :items="service" />
	<ZExpand v-model="expand" in-place :name="t('site.buildInfo')">
		<ZDlGroup size="small" :items="techstack" />
	</ZExpand>
</BlogWidget>
</template>

<style scoped>
.z-expand {
	margin-top: 0.2em;
}
</style>
