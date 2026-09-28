<script setup lang="ts">
import type { VNodeChild } from 'vue'
import type { CommentBlock, CommentInline } from '~/types/comment'

/**
 * 评论正文。服务端已把正文洗成白名单结构，这里用渲染函数逐个生成节点：
 * 文字一律是文本节点，没有 `v-html`，也没有 HTML 字符串。
 */
const props = defineProps<{
	body: CommentBlock[]
}>()

// 服务端已过白名单，这里再挡一次，万一上游改了也不会渲染出危险链接
const SAFE_URL = /^https?:\/\//i

function inline(node: CommentInline): VNodeChild {
	switch (node.type) {
		case 'text':
			return node.value
		case 'code':
			return h('code', node.value)
		case 'break':
			return h('br')
		case 'strong':
		case 'em':
		case 'del':
			return h(node.type, node.children.map(inline))
		case 'link':
			return SAFE_URL.test(node.href)
				? h('a', { href: node.href, target: '_blank', rel: 'noopener noreferrer nofollow ugc' }, node.children.map(inline))
				: h('span', node.children.map(inline))
		// 只有站点自己存储的图片会走到这里（服务端按地址前缀挑过）
		case 'image':
			return /^https:\/\//i.test(node.src)
				? h('img', { class: 'comment-image', src: node.src, alt: node.alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
				: node.alt
	}
}

function block(node: CommentBlock): VNodeChild {
	switch (node.type) {
		case 'paragraph':
			return h('p', node.children.map(inline))
		case 'code':
			return h('pre', h('code', node.value))
		case 'quote':
			return h('blockquote', node.children.map(block))
		case 'list':
			return h(node.ordered ? 'ol' : 'ul', node.items.map(item => h('li', item.map(block))))
	}
}

const Blocks = () => props.body.map(block)
</script>

<template>
<div class="comment-body">
	<Blocks />
</div>
</template>

<style scoped>
.comment-body {
	overflow-wrap: anywhere;
	line-height: 1.7;

	:deep() {
		p, pre, blockquote, ul, ol {
			margin: 0.3em 0;
		}

		pre {
			overflow: auto;
			padding: 0.5em 0.8em;
			border-radius: 0.5em;
			background-color: var(--c-bg-2);
			font-size: 0.85em;
		}

		code {
			font-family: var(--font-monospace);
			font-size: 0.9em;
		}

		:not(pre) > code {
			padding: 0.1em 0.3em;
			border-radius: 0.3em;
			background-color: var(--c-bg-2);
		}

		.comment-image {
			display: block;
			max-width: min(100%, 24em);
			max-height: 20em;
			margin: 0.4em 0;
			border-radius: 0.5em;
			object-fit: contain;
		}

		a {
			margin: -0.1em -0.2em;
			padding: 0.1em 0.2em;
			background: linear-gradient(var(--c-primary-soft), var(--c-primary-soft)) no-repeat center bottom / 100% 0.1em;
			color: var(--c-primary);
			transition: all 0.2s;

			&:hover {
				border-radius: 0.3em;
				background-size: 100% 100%;
			}
		}

		ul, ol {
			padding-inline-start: 1.5em;
			list-style: revert;

			> li::marker {
				color: var(--c-primary);
			}
		}

		blockquote {
			padding: 0.2em 0.5em;
			border-inline-start: 4px solid var(--c-border);
			border-radius: 4px;
			background-color: var(--c-bg-2);
			font-size: 0.95em;
		}
	}
}
</style>
