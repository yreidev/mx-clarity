import zin from '@zinkawaii/stylelint-config'

// @zinkawaii/stylelint-config 0.5 去掉了 scss 支持（0.4 还带 stylelint-config-standard-scss）：
// 独立的 .scss 文件被当成 CSS 解析，`@mixin`、`//` 注释都报错；.vue 里 `lang="scss"` 的样式块因为缺解析器，其实一直没被检查。
// 这里装上 postcss-scss（.vue 的样式块也会自动用它），放行 scss 的 at 规则；媒体查询里的 scss 变量要编译后才有值，这条规则对 scss 关掉
const SCSS_AT_RULES = ['mixin', 'include', 'use', 'forward', 'function', 'return', 'each', 'for', 'if', 'else', 'while', 'extend', 'content', 'at-root', 'debug', 'warn', 'error']

export default zin({
	// @keep-sorted
	rules: {
		'@stylistic/indentation': 'tab',
		'media-feature-range-notation': 'prefix',
	},
	overrides: [
		{
			files: ['**/*.scss'],
			customSyntax: 'postcss-scss',
			rules: {
				'at-rule-no-unknown': [true, { ignoreAtRules: SCSS_AT_RULES }],
				'media-query-no-invalid': null,
			},
		},
		{
			files: ['**/*.vue'],
			rules: {
				'at-rule-no-unknown': [true, { ignoreAtRules: SCSS_AT_RULES }],
				'media-query-no-invalid': null,
			},
		},
	],
})
