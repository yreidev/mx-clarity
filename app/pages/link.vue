<script setup lang="ts">
import type { FeedEntry } from '~/types/feed'

/**
 * 友链：列表、本站信息与申请都来自 mx。
 * 「申请友链」一栏显示 mx 里 slug 为 `link` 的独立页（有的话），它的评论区放在页面底部。
 */
const t = useT()
const { data: site } = await useMxSite()
const { data: links } = await useMxLinks()
const { data: intro } = await useMxPage('link', { optional: true })

const appConfig = useAppConfig()

useSeoMeta({
	title: () => t('common.friends'),
	ogType: 'profile',
	description: () => t('friends.friendsPageSites', { site: site.value.title }),
})

// 原先取 blog.config.ts 的 myFeed，那是上游作者的信息；改用 mx 的站点配置
const myFeed = computed<FeedEntry>(() => ({
	author: site.value.author.name,
	title: site.value.title,
	desc: site.value.description,
	link: site.value.webUrl,
	avatar: site.value.author.avatar,
	icon: site.value.icon,
}))

const copyFields = computed(() => ({
	[t('friends.author')]: myFeed.value.author,
	[t('friends.title')]: site.value.title,
	[t('friends.description')]: site.value.description,
	[t('friends.website')]: site.value.webUrl,
	[t('friends.avatar')]: site.value.author.avatar,
}))
</script>

<template>
<div class="mobile-only">
	<BlogHeader to="/" :suffix="t('common.friends')" tag="h1" />
</div>

<FeedGroup
	v-for="group in links?.groups"
	:key="group.name"
	v-bind="group"
	:shuffle="appConfig.link.randomInGroup"
/>
<details v-if="links?.banned?.length" class="link-banned">
	<summary>{{ t('friends.inactive', { n: links.banned.length }) }}</summary>
	<p>{{ t('friends.ownerHasRemoved') }}</p>
	<ul>
		<li v-for="name in links.banned" :key="name">
			{{ name }}
		</li>
	</ul>
</details>
<p v-if="!links" class="link-empty">
	{{ t('friends.couldntLoadFriends') }}
</p>
<p v-else-if="!links.groups.length" class="link-empty">
	{{ t('friends.noFriendLinks') }}
</p>

<Tab :tabs="[t('friends.myBlogInfo'), t('friends.requestLinkExchange')]" center>
	<template #tab1>
		<div class="link-tab">
			<FeedCard v-bind="myFeed" />
			<Copy v-for="(code, prompt) in copyFields" :key="prompt" :prompt :code />
		</div>
	</template>
	<template #tab2>
		<MxRenderer
			v-if="intro"
			:body="intro.body"
			class="article"
		/>
		<LinkApplyForm v-if="links?.canApply" />
		<p v-else class="link-empty">
			{{ t('friends.ownerIsntAccepting') }}
		</p>
	</template>
</Tab>

<PostComment v-if="intro?.article.meta?.__id" :key="intro.article.meta.__id" :ref-id="intro.article.meta.__id" />
</template>

<style lang="scss" scoped>
.link-banned {
	margin: 1rem;
	font-size: 0.9em;
	color: var(--c-text-2);

	summary {
		cursor: pointer;
	}

	p {
		margin: 0.4em 0;
		font-size: 0.9em;
		color: var(--c-text-3);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3em 1em;
		opacity: 0.6;
		margin: 0;
		padding: 0;
		list-style: none;
	}
}

.link-tab {
	margin: 1rem;
}

.link-empty {
	margin: 2rem 1rem;
	text-align: center;
	color: var(--c-text-2);
}
</style>
