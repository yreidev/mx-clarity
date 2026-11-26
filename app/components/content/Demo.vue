<script setup lang="ts">
defineProps<{
	raw: string
	meta?: string
}>()

const t = useT()
</script>

<template>
<Tab :tabs="[t('content.demoPreview'), t('content.demoSyntax')]">
	<template #tab1>
		<slot />
	</template>
	<template #tab2>
		<ProsePre :code="raw" language="mdc" :meta />
	</template>
</Tab>
</template>
