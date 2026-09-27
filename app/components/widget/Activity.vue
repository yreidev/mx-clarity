<script setup lang="ts">
import type { RecentActivity } from '~/types/home'

/** 首页侧栏「最近动态」：最近的碎碎念与评论。只在浏览器里取；被评论的内容都是公开的（服务端比对过） */
const { data } = useLazyFetch<RecentActivity>('/api/mx/activity', { key: 'mx-activity', server: false })
const t = useT()
const uiLang = useUiLang()
</script>

<template>
<BlogWidget v-if="data?.thinking.length || data?.comments.length" card :title="t('site.recentActivity')">
	<section v-if="data.thinking.length" class="activity-section">
		<h3>
			<Icon name="tabler:message-circle" /> {{ t('common.thinking') }}
			<UtilLink to="/thinking" class="activity-more">
				{{ t('common.more') }}
			</UtilLink>
		</h3>
		<ol class="activity-list">
			<li v-for="item in data.thinking" :key="item.id">
				<UtilLink :to="item.path" class="activity-excerpt activity-thinking">
					{{ item.excerpt }}
				</UtilLink>
			</li>
		</ol>
	</section>
	<section v-if="data.comments.length" class="activity-section">
		<h3><Icon name="tabler:message-dots" /> {{ t('site.latestComments') }}</h3>
		<ol class="activity-list">
			<li v-for="(item, index) in data.comments" :key="index" class="activity-comment">
				<img v-if="item.avatar" :src="item.avatar" alt="" loading="lazy" referrerpolicy="no-referrer" class="activity-avatar">
				<Icon v-else name="tabler:user-circle" class="activity-avatar" />
				<div class="activity-main">
					<p class="activity-meta">
						<b>{{ visitorNameText(uiLang, item.author) }}</b> {{ t('site.commentedOn') }}
						<UtilLink :to="item.path">
							{{ t(item.title) }}
						</UtilLink>
					</p>
					<div class="activity-excerpt">
						{{ item.excerpt }}
					</div>
				</div>
			</li>
		</ol>
	</section>
</BlogWidget>
</template>

<style lang="scss" scoped>
.activity-section + .activity-section {
	margin-top: 0.8em;
}

h3 {
	display: flex;
	align-items: center;
	gap: 0.3em;
	margin-bottom: 0.3em;
	font-size: 0.85em;
	color: var(--c-text-2);
}

.activity-more {
	margin-inline-start: auto;
	font-size: 0.9em;
	color: var(--c-text-3);

	&:hover {
		color: var(--c-primary);
	}
}

.activity-list {
	display: grid;
	gap: 0.6em;
	margin: 0;
	padding: 0;
	font-size: 0.85em;
	list-style: none;
}

.activity-comment {
	display: flex;
	gap: 0.5em;
	min-width: 0;
}

.activity-avatar {
	flex-shrink: 0;
	width: 1.8em;
	height: 1.8em;
	border-radius: 50%;
	color: var(--c-text-3);
	object-fit: cover;
}

.activity-main {
	min-width: 0;
}

.activity-meta {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: var(--c-text-2);

	a {
		color: var(--c-primary);
	}
}

.activity-excerpt {
	display: -webkit-box;
	overflow: hidden;
	overflow-wrap: anywhere;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
}

.activity-thinking:hover {
	color: var(--c-primary);
}
</style>
