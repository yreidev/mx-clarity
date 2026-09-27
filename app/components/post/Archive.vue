<script setup lang="ts">
import type { ArticleProps } from '~/types/article'

const props = defineProps<{
	to?: string
	useUpdated?: boolean
	showCategory?: boolean
	/** 不按分类取图标时指定，时间线里的日记用 */
	icon?: string
} & ArticleProps>()

const mainDate = computed(() => props.useUpdated ? props.updated : props.date)
const timeZone = useSiteTimeZone()
const t = useT()
</script>

<template>
<li class="article-item">
	<UtilDate class="dim-hover" :date="mainDate" format="monthDay" />

	<div class="gradient-card" :style="{ '--c-accent': getCategoryColor(categories?.[0]) }">
		<UtilLink class="article-link scrollbar-hidden scrollcheck-x" :to :title="description">
			<span class="article-title">
				<Icon v-if="showCategory" :name="icon ?? getCategoryIcon(categories?.[0])" />
				{{ title }}
				<!-- 前缀版的列表里，这一篇拿到的是 AI 译文（列表紧凑，只放图标） -->
				<span v-if="translated" v-tip="t('post.aiTranslation')" class="article-translated">
					<Icon name="tabler:language" />
					<span class="visually-hidden">{{ t('post.aiTranslation') }}</span>
				</span>
			</span>

			<UtilDate
				v-if="date && useUpdated && isTimeDiffSignificant(date, updated)"
				class="dim-hover info"
				:date="date"
				:format="updated && isSameUnit(date, updated, 'year', timeZone) ? 'monthDay' : 'date'"
			/>

			<ul v-if="tags?.length" class="dim-hover info tag-list">
				<li v-for="tag in tags" :key="tag" v-text="tagNames?.[tag] ?? tag" />
			</ul>
		</UtilLink>
	</div>
</li>
</template>

<style lang="scss" scoped>
.article-item {
	display: flex;
	align-items: center;
	column-gap: 0.5em;
	min-width: 0;
	margin: var(--archive-item-gap, 0.2em) 0;
	transition: all 0.2s;
	animation: float-in 0.2s var(--delay) backwards;

	@media (max-width: $breakpoint-mobile) {
		font-size: 0.9em;
	}

	.dim-hover {
		opacity: 0.4;
		transition: opacity 0.2s;
	}

	:deep(time) {
		font-variant-numeric: tabular-nums;
	}

	.info {
		font-size: 0.8em;
	}

	&:hover,
	&:focus-within {
		.article-title {
			color: var(--c-text);
		}

		.dim-hover {
			opacity: 1;
		}
	}
}

.article-translated {
	color: var(--c-primary);
}

.gradient-card {
	flex-grow: 1;
	min-width: 0;
}

.article-link {
	--scrollbar-height: 0px;

	display: flex;
	align-items: baseline;
	gap: 1em;
	padding: 0.3em 0.6em;
	white-space: nowrap;

	> .tag-list {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.5em;
		margin-left: auto;

		&::before {
			content: "#";
			opacity: 0.5;
		}
	}
}
</style>
