<script setup lang="ts">
import type { SubscribeType } from '~/types/subscribe'

/** 正文后面、点赞旁边的「订阅」：站长在 admin 里开了邮件订阅才显示，点开是订阅框，默认只勾当前这一类（文章或日记） */
const props = defineProps<{
	type: SubscribeType
}>()

const { data: status } = useSubscribeStatus()
const t = useT()
const dialog = useTemplateRef('dialog')
</script>

<template>
<div v-if="status?.enable && status.types.length" class="post-subscribe">
	<button type="button" class="post-action" aria-haspopup="dialog" @click="dialog?.open(props.type)">
		<Icon name="tabler:mail" />
		<span>{{ t('subscribe.subscribe') }}</span>
	</button>
	<BlogSubscribeDialog ref="dialog" />
</div>
</template>
