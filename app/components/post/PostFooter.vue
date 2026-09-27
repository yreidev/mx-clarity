<script setup lang="ts">
import type { ArticleProps } from '~/types/article'

defineOptions({ inheritAttrs: false })
// copyright 是布尔属性：没传时 Vue 会当成 false，这里默认为 true（只有站长关掉的文章才是 false）
withDefaults(defineProps<ArticleProps>(), { copyright: true })

const [DefineTemplate, ReuseTemplate] = createReusableTemplate<{
	title: string
}>({ inheritAttrs: false })

const { data: theme } = useMxTheme()
const t = useT()
</script>

<template>
<div class="post-footer">
	<DefineTemplate v-slot="{ $slots, title }">
		<section>
			<div class="title text-creative">
				{{ title }}
			</div>

			<div class="content">
				<component :is="$slots.default" />
			</div>
		</section>
	</DefineTemplate>

	<ReuseTemplate v-if="references" :title="t('post.references')">
		<ul>
			<li v-for="{ title, link }, i in references" :key="i">
				<ProseA :href="link || ''">
					{{ title ?? link }}
				</ProseA>
			</li>
		</ul>
	</ReuseTemplate>

	<ReuseTemplate v-if="tags?.length" :title="t('post.tags')">
		<ul class="post-tags">
			<li v-for="tag in tags" :key="tag">
				<UtilLink :to="tagPath(tag)" class="post-tag">
					<Icon name="tabler:hash" />{{ tagNames?.[tag] ?? tag }}
				</UtilLink>
			</li>
		</ul>
	</ReuseTemplate>

	<!-- 付费文章不给转载许可；站长关了这篇的「版权」开关就不显示这一栏 -->
	<ReuseTemplate v-if="copyright !== false && premium" :title="t('post.copyright')">
		<p>{{ t('post.allRightsReserved') }}</p>
	</ReuseTemplate>
	<ReuseTemplate v-else-if="copyright !== false" :title="t('post.license')">
		<p>
			{{ t('post.postLicensedUnder') }} <ProseA :href="theme.license.url">
				{{ t(theme.license.name) }}
			</ProseA>
			{{ t('post.licensePleaseCredit') }}
		</p>
	</ReuseTemplate>
</div>
</template>

<style lang="scss" scoped>
.post-footer {
	margin: 2rem 0.5rem;
	border: 1px solid var(--c-border);
	border-radius: 1rem;
	background-color: var(--c-bg-2);
}

section {
	padding: 1rem;

	& + section {
		border-top: 1px solid var(--c-border);
	}
}

.title {
	font-weight: bold;
	color: var(--c-text);
}

.content {
	margin-top: 0.5em;
	font-size: 0.9rem;

	li {
		margin: 0.5em 0;
	}
}

.post-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5em;

	> li {
		margin: 0;
	}
}

.post-tag {
	display: inline-flex;
	align-items: center;
	padding: 0.1em 0.6em 0.1em 0.4em;
	border-radius: 1em;
	background-color: var(--c-bg-1);
	color: var(--c-text-2);
	transition: color 0.2s, background-color 0.2s;

	&:hover {
		background-color: var(--c-primary-soft);
		color: var(--c-primary);
	}
}
</style>
