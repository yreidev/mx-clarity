import { msg } from './shared/utils/i18n'

// core 不可用时的兜底值。站名、描述、图标、作者、站点地址平时都取 mx 的设置，不用改这里
const basicConfig = {
	title: '我的博客',
	description: '一个用 mx-space 与 mx-clarity 搭的博客。',
	author: {
		name: '博主',
		avatar: '/images/avatar.svg',
	},
	favicon: '/favicon.svg',
	language: 'zh-CN',
	url: 'https://blog.example.com',
	defaultCategory: '未分类',
}

// 存储 nuxt.config 和 app.config 共用的配置
// 此处为启动时需要的配置，启动后可变配置位于 app/app.config.ts
// @keep-sorted
const blogConfig = {
	...basicConfig,

	article: {
		categories: {
			[basicConfig.defaultCategory]: { icon: 'tabler:circle-dashed' },
			/** 实践可复用操作经验：工具/系统/部署/排障 */
			技术: { icon: 'tabler:mouse', color: '#33aaff' },
			/** 编程：代码实现/工程实践/开发方法 */
			开发: { icon: 'tabler:code', color: '#7777ff' },
			/** 安全：漏洞/CTF/恶意软件/安全事件分析 */
			安全: { icon: 'tabler:bug', color: '#ff7733' },
			/** 思考：观点讨论/复盘反思/行业或产品观察 */
			杂谈: { icon: 'tabler:message', color: '#33bbaa' },
			/** 记录叙事：个人经历/校园家庭/日常片段 */
			生活: { icon: 'tabler:leaf', color: '#ff7777' },
		},
		/** 文章版式，首个为默认版式 */
		types: {
			tech: {},
			story: {},
		},
		/** 分类排序方式，键为排序字段，值为显示名称 */
		order: {
			date: msg('post.dateCreated'),
			updated: msg('post.dateUpdated'),
			// title: '标题',
		},
		/** 禁止搜索引擎收录的路径（草稿预览：分享链接里带着令牌） */
		robotsNotIndex: ['/preview'],
	},

}

export default blogConfig
