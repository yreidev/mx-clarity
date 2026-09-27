import antfu from '@antfu/eslint-config'

export default antfu({
	// Markdown 只有说明文档，代码块是讲解用的片段；eslint 对它的自动修复会把代码块的结束标记并到上一行（实测弄坏过文档）
	ignores: ['*.yaml', '**/*.md'],
	stylistic: {
		indent: 'tab',
	},
	pnpm: true,
	// @keep-sorted
	rules: {
		'jsonc/indent': ['error', 2],
		'vue/block-lang': ['warn', {
			script: { lang: ['ts', 'tsx'] },
			style: { lang: ['scss'] },
		}],
		'vue/enforce-style-attribute': ['warn', {
			allow: ['scoped'],
		}],
		'vue/html-indent': ['error', 'tab', { baseIndent: 0 }],
		'yaml/indent': ['error', 2],
	},
}, {
	files: ['app/pages/**/*.vue'],
	rules: {
		'vue/valid-v-slot': 'off',
	},
}, {
	// api-client 只允许出现在 app/utils/mx/** 里（test/mx/layering.test.ts 做同样的检查）
	files: ['**/*.{ts,mts,js,mjs,vue}'],
	// 探针脚本与 Markdown 里的代码块直接用 api-client，不受此限
	ignores: ['app/utils/mx/**', 'scripts/probe/**', 'test/**', '**/*.md/**'],
	rules: {
		'no-restricted-imports': ['error', {
			patterns: [{
				group: ['@mx-space/api-client', '@mx-space/api-client/*'],
				message: '只有 app/utils/mx/** 能 import api-client，其他地方复用 app/utils/mx 的导出',
			}],
		}],
	},
}, {
	// 页面、组件、布局、composable、插件都不自己建 core 的 client：浏览器里用 useCoreClient()，服务端用 useServerMxClient
	files: ['app/pages/**/*.vue', 'app/components/**/*.vue', 'app/layouts/**/*.vue', 'app/composables/**/*.ts', 'app/plugins/**/*.ts'],
	rules: {
		'no-restricted-syntax': ['error', {
			selector: 'CallExpression[callee.name=\'createMxClient\']',
			message: '不自己建 core 的 client：浏览器里用 useCoreClient()，服务端用 useServerMxClient',
		}],
	},
}, {
	// 全项目禁 v-html（内容来自 mx，要当不可信处理）。下列是 blog-v3 原有的用法，不许再加
	files: ['**/*.vue'],
	// @keep-sorted
	ignores: [
		'app/components/content/Mermaid.vue',
		'app/components/content/ProsePre.vue',
	],
	rules: {
		'vue/no-v-html': 'error',
	},
}, {
	// 夹具正文里的特殊空白（全角空格）是有意留的测试数据
	files: ['test/fixtures/**'],
	rules: {
		'no-irregular-whitespace': 'off',
	},
}, {
	files: ['**/*.json'],
	rules: {
		'style/eol-last': ['warn', 'never'],
	},
})
