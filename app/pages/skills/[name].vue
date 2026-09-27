<script setup lang="ts">
import type { MDCRoot } from '@nuxtjs/mdc'

/**
 * 文章附带的 Skill：名称、说明、「复制提示词」、按路径 B 渲染的 SKILL.md 正文、原文链接。
 * 数据来自本站的 `/api/mx/skills/:name`（core 的公开 snippet，缓存 5 分钟）；附件与原文经 `/skills/<名称>/<路径>` 转发
 */
interface SkillDetail {
	slug: string
	name: string
	description: string
	body: MDCRoot
	raw: string
}

const route = useRoute()
const t = useT()
const name = computed(() => String(route.params.name))
const fetcher = useRequestFetch()
const { data: skill, error } = await useAsyncData(() => `mx-skill:${name.value}`, () => fetcher<SkillDetail>(`/api/mx/skills/${encodeURIComponent(name.value)}`))

const { data: site } = useMxSite()
const copied = ref(false)
async function copyPrompt() {
	if (!skill.value)
		return
	const base = (site.value.webUrl || location.origin).replace(/\/+$/, '')
	try {
		await navigator.clipboard.writeText(t('skill.pleaseReadFollow', { url: `${base}${skill.value.raw}` }))
		copied.value = true
		setTimeout(() => copied.value = false, 2000)
	}
	catch {}
}

if (skill.value) {
	useSeoMeta({
		title: () => skill.value?.name,
		description: () => skill.value?.description || t('skill.aiSkill', { site: site.value.title }),
	})
}
else {
	const event = useRequestEvent()
	event && setResponseStatus(event, error.value?.statusCode === 404 || !error.value ? 404 : 503)
	route.meta.title = '404'
}
</script>

<template>
<div v-if="skill" class="skill proper-height">
	<header class="skill-header">
		<span class="skill-kicker"><Icon name="tabler:puzzle" /> AI Skill</span>
		<h1>{{ skill.name }}</h1>
		<p v-if="skill.description" class="skill-description">
			{{ skill.description }}
		</p>
		<div class="skill-actions">
			<ZButton :icon="copied ? 'tabler:check' : 'tabler:copy'" :text="copied ? t('common.copied') : t('skill.copyPrompt')" @click="copyPrompt" />
			<a :href="skill.raw" class="skill-raw" target="_blank" rel="noopener">{{ t('skill.viewRawMarkdown') }}</a>
		</div>
	</header>
	<MxRenderer class="article" :body="skill.body" />
</div>
<ZError v-else icon="line-md:document-delete-twotone" :title="t('skill.skillNotFound')" />
</template>

<style lang="scss" scoped>
.skill {
	padding: 1rem;
}

.skill-header {
	display: grid;
	gap: 0.5em;
	margin: 1rem;

	> h1 {
		margin: 0;
		font-size: 1.6rem;
	}
}

.skill-kicker {
	display: inline-flex;
	align-items: center;
	gap: 0.3em;
	font-size: 0.8em;
	letter-spacing: 0.05em;
	color: var(--c-primary);
}

.skill-description {
	margin: 0;
	color: var(--c-text-2);
}

.skill-actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 1em;
}

.skill-raw {
	font-size: 0.9em;
	color: var(--c-text-2);

	&:hover {
		color: var(--c-primary);
	}
}
</style>
