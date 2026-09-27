<script setup lang="ts">
import type { VNodeChild } from 'vue'

interface DlItem {
	label: string
	value: MaybeRefOrGetter<VNodeChild>
	tip?: MaybeRefOrGetter<string>
}

withDefaults(defineProps<{
	items: DlItem[]
	size?: 'small' | 'medium' | 'large'
}>(), {
	size: 'medium',
})
</script>

<template>
<dl class="dl-group" :class="size">
	<div v-for="{ label, value, tip } in items" :key="label">
		<dt>{{ label }}</dt>
		<dd :title="toValue(tip)">
			<!-- 支持 string, Ref<String>, VNode, () => VNode -->
			<component :is="() => toValue(value)" />
		</dd>
	</div>
</dl>
</template>

<style lang="scss" scoped>
.dl-group {
	> div {
		padding: 0.2em 0;

		> dt {
			font-size: 0.9em;
			color: var(--c-text-2);
		}
	}
}

// 每行三项、列宽相等，上下行对齐；最后一行不满三项时往里挪半列，居中。
// 每项占两行轨道（标签、数值），标签折成两行时同一行的数值仍在一条线上
.dl-group.small {
	display: grid;
	grid-template-columns: repeat(6, 1fr);
	text-align: center;

	> div {
		display: grid;
		grid-column: span 2;
		grid-row: span 2;
		grid-template-rows: subgrid;
		padding-block: 0.25em;
		text-wrap: balance;

		> dt {
			align-self: end;
		}
	}

	> div:nth-child(3n + 1):nth-last-child(2) {
		grid-column: 2 / span 2;
	}

	> div:nth-child(3n + 1):last-child {
		grid-column: 3 / span 2;
	}
}

.dl-group.medium {
	display: grid;
	grid-template-columns: auto auto;
	gap: 0.4em 8%;
	padding: 0.2em 0;

	> div {
		display: contents;

		> dt {
			font-size: inherit;
			text-align: end;
		}
	}
}
</style>
