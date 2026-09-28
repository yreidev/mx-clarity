<script setup lang="ts">
/**
 * 正文里的附件（Lexical 的 file）：名称、类型、大小，点开或下载。
 * 属性在服务端洗过：地址只有 http(s) 与站内路径，名称是纯文本。不在浏览器里预览内容（要跨域取，或加载第三方脚本）
 */
const props = defineProps<{
	src: string
	name: string
	ext?: string
	size?: string
}>()

const ICONS: Record<string, string> = {
	'pdf': 'tabler:file-type-pdf',
	'zip': 'tabler:file-zip',
	'rar': 'tabler:file-zip',
	'7z': 'tabler:file-zip',
	'md': 'tabler:markdown',
	'txt': 'tabler:file-text',
	'doc': 'tabler:file-type-doc',
	'docx': 'tabler:file-type-docx',
	'xls': 'tabler:file-type-xls',
	'xlsx': 'tabler:file-spreadsheet',
	'ppt': 'tabler:file-type-ppt',
	'pptx': 'tabler:file-type-ppt',
	'png': 'tabler:photo',
	'jpg': 'tabler:photo',
	'jpeg': 'tabler:photo',
	'gif': 'tabler:photo',
	'webp': 'tabler:photo',
	'mp3': 'tabler:music',
	'mp4': 'tabler:movie',
}
const icon = computed(() => (props.ext && ICONS[props.ext]) || 'tabler:file')
// 站内的文件浏览器才认 download 属性；别处的在新标签页打开
const sameOrigin = computed(() => props.src.startsWith('/') && !props.src.startsWith('//'))
const t = useT()
</script>

<template>
<a
	class="file-card card"
	:href="src"
	:target="sameOrigin ? undefined : '_blank'"
	:rel="sameOrigin ? undefined : 'noopener noreferrer nofollow'"
	:download="sameOrigin ? name : undefined"
>
	<Icon :name="icon" class="file-card-icon" />
	<span class="file-card-info">
		<span class="file-card-name">{{ name }}</span>
		<span class="file-card-meta">{{ [ext?.toUpperCase(), size].filter(Boolean).join(' · ') || t('content.attachment') }}</span>
	</span>
	<Icon name="tabler:download" class="file-card-action" />
</a>
</template>

<style scoped>
.file-card {
	display: flex;
	align-items: center;
	gap: 0.8em;
	width: 24rem;
	max-width: 100%;
	margin: 1.5em auto;
	padding: 0.7em 1em;
	font-size: 0.9em;
	color: var(--c-text);

	&:hover {
		color: var(--c-primary);
	}
}

.file-card-icon {
	flex-shrink: 0;
	font-size: 1.8em;
	color: var(--c-primary);
}

.file-card-info {
	display: grid;
	flex-grow: 1;
	min-width: 0;
}

.file-card-name {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.file-card-meta {
	font-size: 0.85em;
	color: var(--c-text-3);
}

.file-card-action {
	flex-shrink: 0;
	color: var(--c-text-3);
}
</style>
