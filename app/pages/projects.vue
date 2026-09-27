<script setup lang="ts">
/**
 * 项目。照 Yohaku 不做详情页，卡片上的按钮直接去项目、预览、文档地址。
 */
const t = useT()
const { data: site } = useMxSite()
useSeoMeta({
	title: () => t('common.projects'),
	description: () => t('projects.projectsBy', { site: site.value.title }),
})

const { data: projects, error } = await useMxProjects()

const LINKS = computed(() => [
	// 项目地址不一定在 GitHub，图标按网址认，认不出来用通用的代码图标
	{ key: 'project', text: t('projects.project'), icon: 'tabler:code' },
	{ key: 'preview', text: t('projects.preview'), icon: 'tabler:eye' },
	{ key: 'doc', text: t('projects.docs'), icon: 'tabler:book' },
] as const)
</script>

<template>
<div class="projects proper-height">
	<div class="mobile-only">
		<BlogHeader to="/" :suffix="t('common.projects')" tag="h1" />
	</div>

	<p v-if="error" class="projects-empty">
		{{ t('projects.projectsUnavailableRight') }}
	</p>
	<p v-else-if="!projects.length" class="projects-empty">
		{{ t('projects.noProjectsYet') }}
	</p>

	<menu class="project-list">
		<li v-for="project in projects" :key="project.id" class="project-card card">
			<div class="project-head">
				<img
					v-if="project.avatar"
					class="project-avatar"
					:src="project.avatar"
					:alt="project.name"
					loading="lazy"
					referrerpolicy="no-referrer"
				>
				<Icon v-else class="project-avatar" name="tabler:package" />
				<h2 class="project-name text-creative">
					{{ project.name }}
				</h2>
			</div>
			<p class="project-desc">
				{{ project.description }}
			</p>
			<div class="project-links">
				<template v-for="link in LINKS" :key="link.key">
					<ZButton
						v-if="project.links[link.key]"
						:to="project.links[link.key]"
						:icon="link.key === 'project' ? getDomainIcon(project.links.project!) ?? link.icon : link.icon"
						:text="link.text"
					/>
				</template>
			</div>
		</li>
	</menu>
</div>
</template>

<style lang="scss" scoped>
.projects {
	padding: 1rem;
}

.projects-empty {
	margin: 3rem 0;
	text-align: center;
	color: var(--c-text-2);
}

.project-list {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(16em, 1fr));
	gap: 1em;
}

.project-card {
	display: flex;
	flex-direction: column;
	gap: 0.6em;
	padding: 1em;
	border-radius: 0.8em;
}

.project-head {
	display: flex;
	align-items: center;
	gap: 0.6em;
}

.project-avatar {
	flex-shrink: 0;
	width: 2.4em;
	height: 2.4em;
	border-radius: 0.5em;
	color: var(--c-text-3);
	object-fit: cover;
}

.project-name {
	font-size: 1.1em;
}

.project-desc {
	flex-grow: 1;
	font-size: 0.9em;
	color: var(--c-text-2);
}

.project-links {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5em;
	font-size: 0.85em;
}
</style>
