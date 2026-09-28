<script setup lang="ts">
/**
 * 链接卡片。标题、描述、站名、几项属性、主色来自 core 的链接数据（服务端净化过的纯文本，不带第三方图片）；
 * 链接永远是作者写的网址
 */
const props = defineProps<{
	link: string
	title: string
	description?: string
	icon?: string
	mirror?: ImgService
	/** github、media、academic、code、self、music、book、web */
	kind?: string
	site?: string
	/** 属性（「标签：值」的数组）序列化成的 JSON 字符串 */
	facts?: string
	accent?: string
}>()

const KIND_ICONS: Record<string, string> = {
	github: 'tabler:brand-github',
	media: 'tabler:movie',
	academic: 'tabler:school',
	code: 'tabler:code',
	self: 'tabler:file-text',
	music: 'tabler:music',
	book: 'tabler:book',
}
const kindIcon = computed(() => (props.kind && KIND_ICONS[props.kind]) || undefined)
const accentStyle = computed(() => props.accent && /^#[\da-f]{6}$/i.test(props.accent) ? { borderInlineStartColor: props.accent } : undefined)
const facts = computed<string[]>(() => {
	try {
		const parsed = JSON.parse(props.facts ?? '[]')
		return Array.isArray(parsed) ? parsed.filter(fact => typeof fact === 'string').slice(0, 4) : []
	}
	catch {
		return []
	}
})
const meta = computed(() => [props.site || getDomain(props.link), ...facts.value].filter(Boolean).join(' · '))
</script>

<template>
<UtilLink :to="link" class="link-card card" :class="{ 'has-accent': accentStyle }" :style="accentStyle" :data-transition-key="link" :title="joinWith([title, description, link])">
	<div class="link-card-info">
		<div class="link-card-title">
			<Icon v-if="kindIcon" :name="kindIcon" class="link-card-kind" />
			{{ title }}
		</div>
		<div v-if="kind" class="link-card-description multiline">
			{{ description }}
		</div>
		<div class="link-card-description">
			{{ kind ? meta : description ?? getDomain(link) }}
		</div>
	</div>
	<slot name="icon" class="link-card-icon-slot">
		<UtilImg v-if="icon" class="link-card-icon" :src="icon" :mirror />
	</slot>
</UtilLink>
</template>

<style scoped>
.link-card {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.5em 0.8em;
	font-size: 0.9em;
	line-height: 1.4;

	article & {
		width: 20rem;
		max-width: 90%;
		margin: 2rem auto;
	}

	/* 溢出显示省略号 */
	.link-card-info {
		flex-grow: 1;
		overflow: hidden;
	}

	.link-card-title {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	/* 内部需要是块元素 */
	.link-card-description {
		overflow: hidden;
		opacity: 0.5;
		margin-top: 0.2em;
		font-size: 0.9em;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	&.has-accent {
		border-inline-start: 3px solid;
	}

	.link-card-kind {
		opacity: 0.7;
		margin-inline-end: 0.2em;
		vertical-align: -0.1em;
	}

	.link-card-description.multiline {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		white-space: normal;
		-webkit-box-orient: vertical;

		&:empty {
			display: none;
		}
	}

	.link-card-icon {
		flex-shrink: 0;
		height: 3rem;
		max-width: 5rem;
		border-radius: 0.5rem;
		object-fit: cover;
	}
}
</style>
