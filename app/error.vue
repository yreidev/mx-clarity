<script setup lang="ts">
import type { NuxtError } from '#app'
// 布局里的具名插槽（aside）要等页面把插槽登记进去才渲染；pages 下的页面由 @dxup/nuxt 自动包一层 LayoutSlotsForward，
// 错误页不在 pages 下，得自己包，否则服务端渲染错误页时一直等、请求挂住
import { LayoutSlotsForward } from '#build/dxup/layouts.mjs'

defineProps<{
	error: NuxtError & { url?: string }
}>()

const t = useT()
</script>

<template>
<NuxtLayout>
	<LayoutSlotsForward>
		<template #aside>
			<WidgetBlogLog />
		</template>

		<div class="app-error">
			<ZError
				:code="error.stack"
				:message="error.url"
				:title="`[${error.status}] ${error.message}`"
			>
				<template #operation>
					<ZButton :text="t('site.backHome')" @click="clearError({ redirect: '/' })" />
					<ZButton :text="t('site.ignoreContinue')" @click="clearError()" />
				</template>
			</ZError>
		</div>
	</LayoutSlotsForward>
</NuxtLayout>
</template>

<style lang="scss" scoped>
.app-error {
	margin: 1rem;
}
</style>
