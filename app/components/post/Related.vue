<script setup lang="ts">
import type { ContentExtras } from '~/types/article'

/** 文末：站长手动关联的文章、文章附带的 Skill 包。数据已在服务端净化 */
defineProps<{
	extras?: ContentExtras
}>()

const t = useT()
</script>

<template>
<section v-if="extras?.related?.length" class="post-related" aria-labelledby="post-related-title">
	<h2 id="post-related-title" class="post-related-title">
		<Icon name="tabler:link" /> {{ t('post.relatedPosts') }}
	</h2>
	<ul data-peek>
		<li v-for="item in extras.related" :key="item.path">
			<UtilLink :to="item.path" class="post-related-link">
				{{ item.title }}
			</UtilLink>
			<p v-if="item.summary" class="post-related-summary">
				{{ item.summary }}
			</p>
		</li>
	</ul>
</section>

<section v-if="extras?.skills?.length" class="post-related" aria-labelledby="post-skills-title">
	<h2 id="post-skills-title" class="post-related-title">
		<Icon name="tabler:puzzle" /> {{ t('post.skillsIncludedPost') }}
	</h2>
	<ul>
		<li v-for="skill in extras.skills" :key="skill.name">
			<UtilLink v-if="skill.url" :to="skill.url" class="post-related-link">
				{{ skill.name }}
			</UtilLink>
			<span v-else class="post-related-link">{{ skill.name }}</span>
			<p v-if="skill.description" class="post-related-summary">
				{{ skill.description }}
			</p>
		</li>
	</ul>
</section>
</template>

<style lang="scss" scoped>
.post-related {
	margin: 2rem 1.5rem 0;

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.6em;
		margin: 0;
		padding: 0;
		list-style: none;
	}
}

.post-related-title {
	display: flex;
	align-items: center;
	gap: 0.3em;
	margin-bottom: 0.6em;
	font-size: 1rem;
}

.post-related-link {
	font-weight: 600;
	color: var(--c-primary);
}

.post-related-summary {
	margin: 0.2em 0 0;
	font-size: 0.85em;
	color: var(--c-text-2);
}
</style>
