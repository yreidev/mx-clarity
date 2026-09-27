import { pascalCase } from 'es-toolkit/string'
import blogConfig from '~~/blog.config'
import { homepage, name, version } from '~~/package.json'
import { msg } from '~~/shared/utils/i18n'

// 主题自身的界面设置。站点信息（站名、描述、图标、作者、地址）在 mx 的设置里，
// 导航、页脚、许可证等站长要改的在主题配置里（admin 的片段 theme/mx-clarity，见 README），不用改这里
// 图标查询：https://yesicon.app/tabler

// @keep-sorted
export default defineAppConfig({
	// 将 blog.config 中的配置项复制到 appConfig，方便调用
	...blogConfig,

	/**
	 * 分类名 → 文章版式（tech / story）的兜底表。主题配置 categories 里写了 type 的优先；
	 * 两处都没列的分类走 blog.config 的第一个版式
	 */
	articleTypeByCategory: {} as Record<string, string>,

	component: {
		alert: {
			/** 默认使用卡片风格还是扁平风格 */
			defaultStyle: 'card' as 'card' | 'flat',
		},

		codeblock: {
			/** 代码块触发折叠的行数 */
			triggerRows: 32,
			/** 代码块折叠后的行数 */
			collapsedRows: 16,
			/** 启用代码块缩进导航会关闭空格渲染 */
			enableIndentGuide: true,
			/** 代码块缩进导航(Indent Guige)竖线匹配空格数 */
			indent: 4,
			/** tab渲染宽度 */
			tabSize: 3,
		},

		/** 文章开头摘要 */
		excerpt: {
			animation: true,
			caret: '_',
		},

		/** 精选文章 Slide */
		slide: {
			/** 适合封面图无字时启用 */
			showTitle: true,
		},

	},

	/** 友链页面 */
	link: {
		/** 无订阅源展示静音图标。mx 的友链没有订阅源字段，开着会给每一条都打上 */
		remindNoFeed: false,
		/** 友链分组内随机排序 */
		randomInGroup: true,
	},

	pagination: {
		perPage: 10,
		/** 默认排序方式，需要是 this.article.order 中的键名 */
		sortOrder: 'date' as keyof typeof blogConfig.article.order,
		/** 允许（普通/预览/归档）文章列表正序，开启后排序方式左侧图标可切换顺序 */
		allowAscending: false,
	},

	/** 页脚末尾固定带上主题本身与上游 blog-v3 的链接（上游作者请求在页脚保留它的链接）；文字由 BlogFooter 按界面语言写 */
	themeCredit: { name: pascalCase(name), version, homepage, upstream: 'https://github.com/L33Z22L11/blog-v3' },

	themes: {
		light: {
			icon: 'tabler:sun',
			tip: msg('site.lightMode'),
		},
		system: {
			icon: 'tabler:device-desktop',
			tip: msg('site.followSystem'),
		},
		dark: {
			icon: 'tabler:moon',
			tip: msg('site.darkMode'),
		},
	},
})
