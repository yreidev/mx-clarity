import type { Nav, NavItem } from './nav'

/**
 * 主题配置：站长在 mx admin →「配置与云函数」里的 JSON 片段 `theme/mx-clarity`（README「主题配置」）。
 * 站名、描述、图标、作者、站点地址不在这里，取 mx 自己的设置。
 * 所有列表都是对象数组、没有动态键：mx 的客户端会转换响应里的键名，路径、分类名当键会被改坏
 */
export interface ThemeConfig {
	/** 站名下方的一句话，空则不显示 */
	subtitle: string
	header: {
		/** 侧栏顶部的图片，空则用站长头像 */
		logo: string
		/** 显示站名；否则只显示图片 */
		showTitle: boolean
		/** 站名后随机出现的表情 */
		emojiTail: string[]
		/** 站名用的字体（可选）：字体文件要自己准备，只含站名几个字的子集最小 */
		titleFont: { family: string, url: string } | null
	}
	/** 侧栏的导航链接；站点不用日记、说说之类时去掉对应的项 */
	nav: NavItem[]
	footer: {
		/** 页脚版权文字（纯文本），`{year}`、`{author}` 会替换成今年与站长名 */
		copyright: string
		/** 侧栏底部的图标导航 */
		iconNav: NavItem[]
		/** 页脚的链接分组 */
		nav: Nav
	}
	/** 文章许可证，显示在文章末尾与侧栏 */
	license: { abbr: string, name: string, url: string }
	/** 建站日期 YYYY-MM-DD，侧栏统计的「运营时长」由它算，空则不显示 */
	since: string
	/**
	 * 站点时区（IANA 名，如 `Asia/Shanghai`）：页面上的日期、归档与统计的分年都按它。
	 * 片段里没填或填错时为空串；`/api/mx/theme` 下发的是服务端算好的生效值（见 `resolveTimeZone`），永不为空
	 */
	timeZone: string
	/**
	 * admin 的地址（站长在前台看到的「在后台编辑」链到这里）。公开接口不给它；空串表示站点地址加 `/proxy/qaqdmin`
	 */
	adminUrl: string
	/** 默认的分享图（站内路径或 https）：没有封面的文章、日记、独立页与首页都用它；空串表示用站长头像 */
	ogImage: string
	/** 文章多少天没更新就在正文前提醒「可能已经过时」，0 表示不提醒 */
	outdatedDays: number
	/** 出生年份：归档页每年标题旁显示当年的年龄，0 表示不显示 */
	birthYear: number
	/** 侧栏「更新日志」，空则不显示 */
	blogLog: { label: string, value: string }[]
	/** 分类的图标（iconify 名）、颜色与文章版式（`tech` / `story`），按分类名匹配 */
	categories: { name: string, icon?: string, color?: string, type?: string }[]
	/** 旧链接跳转（308），从别的博客搬过来时用 */
	redirects: { from: string, to: string }[]
	/**
	 * 要加到每个页面的外部脚本（统计等），只收 https。脚本要把数据发到自己所在域名以外的地方时，
	 * 在 `connect` 里写上那些域名（`https://域名`，可以 `https://*.域名`），否则会被内容安全策略拦下
	 */
	scripts: { src: string, defer?: boolean, async?: boolean, connect?: string[] }[]
	/**
	 * 站长「此刻」（Companion 桌面端上报的 Live Desk）：在用的应用、在听的音乐。**默认关**；
	 * 窗口标题隐私敏感，`showWindowTitle` 另外打开才显示（碎碎念里 companion 附带的窗口标题也跟着它）
	 */
	liveDesk: { enable: boolean, showWindowTitle: boolean }
	/** 站长状态（表情加一句话）：站长自己装的云函数（如 `shiro/status`），空串表示不显示 */
	ownerStatus: { fn: string }
	/**
	 * 多语言：开放哪些语言的 AI 译文（`en ja ko fr de es ru pt it` 里挑，应与 admin 里 AI 翻译的目标语言一致）。
	 * 默认空 = 关闭。开了的语言多一份 `/<语言>/...` 的前缀版地址；界面文字仍是中文
	 */
	i18n: { languages: string[] }
	comments: {
		/**
		 * 评论下显示「浏览器 · 系统」。开着时发评论会把读者的浏览器标识（UA）转给 core，
		 * core 的公开评论接口会原样返回它；关掉就不转、不显示
		 */
		showAgent: boolean
		/**
		 * 评论图片另外放行的地址前缀（core 把评论图片传到 S3 自定义域名时填，如 `https://cdn.example.com/`），只收 https。
		 * 站点自己（`/api/v3/objects/image/`）与 core 的地址不用填
		 */
		imageHosts: string[]
	}
}
