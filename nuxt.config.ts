import { arch, env, version as nodeVersion, platform } from 'node:process'
import { name as ciName } from 'ci-info'
import { pascalCase } from 'es-toolkit/string'
import { Temporal } from 'temporal-polyfill'
import blogConfig from './blog.config'
import packageJson from './package.json'
import { CANDIDATE_LANGS } from './shared/utils/lang'

// 此处配置无需修改
export default defineNuxtConfig({
	app: {
		head: {
			meta: [
				{ name: 'color-scheme', content: 'light dark' },
				// 此处为元数据的生成器标识，不建议修改
				{ 'name': 'generator', 'content': `${pascalCase(packageJson.name)} ${packageJson.version}`, 'data-github-repo': packageJson.homepage },
				{ name: 'mobile-web-app-capable', content: 'yes' },
			],
			link: [
				// 主题自己生成的 Atom
				{ rel: 'alternate', type: 'application/atom+xml', href: '/atom.xml' },
				{ rel: 'stylesheet', href: 'https://s4.zstatic.net/npm/katex@0.16.44/dist/katex.min.css' },
				// "InterVariable", "Inter"
				{ rel: 'stylesheet', href: 'https://s4.zstatic.net/npm/inter-ui@4.1.1/inter-variable.css' },
				{ rel: 'stylesheet', href: 'https://s4.zstatic.net/npm/inter-ui@4.1.1/inter.css' },
				// "JetBrains Mono", 思源宋体 "Noto Serif SC"
				{ rel: 'preconnect', href: 'https://fonts.gstatic.cn', crossorigin: '' },
				{ rel: 'stylesheet', href: 'https://fonts.googleapis.cn/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&family=Noto+Serif+SC:wght@200..900&display=swap' },
				// 抖音美好体 "DOUYINSANSBOLD-GB"
				{ rel: 'stylesheet', href: 'https://fonts.bytedance.com/dfd/api/v1/css?family=DOUYINSANSBOLD-GB&display=swap' },
			],
			templateParams: {
				separator: '|',
			},
			// 站点名跟随 site config，app/plugins/mx-site.ts 按 mx 后台的设置覆盖它
			titleTemplate: '%s %separator %siteName',
			// 站点图标、作者、站长加的统计脚本随 mx 与主题配置在运行时输出（app/composables/useMxTheme.ts）
		},
		rootAttrs: {
			id: 'blog-root',
		},
	},

	compatibilityDate: '2024-08-03',

	components: [
		{ path: '~/components/partial', prefix: 'Z' },
		// 原先由 @nuxt/content 注册为不带路径前缀的全局组件，模板里直接写 <Tab>、<Pic>、<ProseA>。
		// 正文里的动态组件由 MxRenderer 自己按文件名懒加载，这里只管模板
		{ path: '~/components/content', pathPrefix: false },
		'~/components',
	],

	css: [
		'@/assets/css/animation.css',
		'@/assets/css/article.css',
		'@/assets/css/color.css',
		'@/assets/css/font.css',
		'@/assets/css/main.css',
		'@/assets/css/reusable.css',
	],

	// @keep-sorted
	experimental: {
		// 上游开着 extractAsyncDataHandlers，它在生产构建里把 useAsyncData 的函数参数挪进单独的块：
		// 键写成 getter、处理函数用到闭包变量时（app/composables/useMx*.ts 都是）会丢掉闭包，
		// 浏览器端报 NUXT_E3008 / `page is not defined`。取数都是一行 $fetch，拆块没有收益，关掉
		typescriptPlugin: true,
	},

	nitro: {
		// 浏览器直连 core：页面上的请求发到同源的 /api/v3 与 /ws/。生产由反向代理交给 core，这里只管 nuxt dev
		devProxy: {
			'/api/v3': {
				target: env.NUXT_MX_API_URL || 'http://127.0.0.1:2333/api/v3',
				changeOrigin: true,
			},
			'/ws': {
				target: new URL('/ws', env.NUXT_MX_API_URL || 'http://127.0.0.1:2333/api/v3').href,
				changeOrigin: true,
				ws: true,
			},
		},
		// 服务端代码按实际运行的 Node 版本转译（package.json 的 engines），Nitro 默认的 es2019 不认 BigInt 字面量
		esbuild: {
			options: { target: 'node22' },
		},
		prerender: {
			// nuxt-llms 固定把 /llms.txt 加进预渲染：构建时的快照会盖住运行时从 mx 生成的内容，构建时连不上 core 还是空的
			ignore: ['/llms.txt'],
		},
		// 内存缓存设上限：@nuxt/icon 的接口按请求里的图标列表建缓存键、一周不过期，不设上限能被刷满内存
		storage: {
			cache: { driver: 'lru-cache', max: 2000 },
		},
	},

	// @keep-sorted
	routeRules: {
		// 全站的安全响应头（页面另有最小 CSP，见 server/plugins/security-headers.ts）。
		// admin 与 /api/v3 由反向代理直接转给 core，不经主题，不受影响
		'/**': {
			// 显式写上：nuxt-site-config 把「没写 ssr」当成不走 SSR，会往每个页面正文里多插一段没有 nonce 的
			// window.__NUXT_SITE_CONFIG__ 脚本（被 CSP 拦下）；站点配置本来就随 Nuxt 的水合数据下发
			ssr: true,
			headers: {
				'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), browsing-topics=()',
				'referrer-policy': 'strict-origin-when-cross-origin',
				'x-content-type-options': 'nosniff',
				// 旧浏览器的防嵌套；认 CSP 的浏览器看 frame-ancestors（可以追加 admin 的域名）
				'x-frame-options': 'SAMEORIGIN',
			},
		},
		// 分类的两个入口都落到 /posts/:category；首页就是文章列表
		'/categories/**': { redirect: { to: '/posts/**', statusCode: 302 } },
		'/posts': { redirect: { to: '/', statusCode: 302 } },
	},

	// mx 相关的地址与访客 IP 的取法：部署时要设的变量见 README「部署」，本地开发的取值见 .env.example，其余见下面各项的说明
	runtimeConfig: {
		/**
		 * 页面的内容安全策略（NUXT_CSP）：`enforce` 生效，`report-only` 只在浏览器控制台报、不拦，`off` 只留防嵌套这条最小的。
		 * 站长加的统计脚本被拦、一时找不到原因时先改成 `report-only`（server/utils/csp.ts）
		 */
		csp: 'enforce' as 'enforce' | 'report-only' | 'off',
		/**
		 * 除本站外还允许哪些站点用 iframe 嵌套页面（NUXT_FRAME_ANCESTORS），空格分隔的 `https://域名`。
		 * 默认只许本站；admin 放在别的域名、又要在 admin 里嵌前台预览时填 admin 的地址
		 */
		frameAncestors: '',
		/** 服务端访问 core 的地址（NUXT_MX_API_URL），填内网地址最快；浏览器另走同源的 /api/v3（public.mxBrowserApiUrl） */
		mxApiUrl: '',
		/** 从哪个请求头取访客 IP（NUXT_MX_CLIENT_IP_HEADER）：x-forwarded-for 取最右段，或 x-real-ip */
		mxClientIpHeader: 'x-forwarded-for' as 'x-forwarded-for' | 'x-real-ip',
		/** core 的 webhook 签名密钥（NUXT_MX_WEBHOOK_SECRET），与 admin 里填的一致；不设就不开 `/api/mx/webhook` */
		mxWebhookSecret: '',
		/** 匿名访客的整页缓存时长（NUXT_PAGE_CACHE，秒）；0 关闭。内容改了由 webhook 立即清掉（server/utils/page-cache.ts） */
		pageCache: 600,
		// @keep-sorted
		public: {
			arch,
			buildTime: Temporal.Now.zonedDateTimeISO().toString(),
			// 构建时所在的 CI（侧栏技术信息显示）；用 docker build 构建时拿不到，为空
			ci: ciName || '',
			/** 读者登录的地址（NUXT_PUBLIC_MX_AUTH_URL），必须与站点同源，由反向代理转给 core 的 /api/v3/auth */
			mxAuthUrl: '/api/v3/auth',
			/**
			 * 浏览器直连 core 的地址（NUXT_PUBLIC_MX_BROWSER_API_URL），默认同源的 /api/v3，由反向代理转给 core。
			 * 实时连接走同一主机的 /ws/web。只有反向代理把 core 放到了别的路径时才要改
			 */
			mxBrowserApiUrl: '/api/v3',
			nodeVersion,
			platform,
		},
	},

	/** 在生产环境启用 sourcemap */
	// sourcemap: true,

	// 样式写标准 CSS 嵌套，由 postcss-nesting 转换（上游 blog-v3 3.8.0 起不再用 Sass）
	postcss: {
		plugins: {
			'postcss-nesting': {},
		},
	},

	vite: {
		build: {
			// 超过 500 kB 的都是按需加载的单个第三方模块，没法再拆：maplibre-gl（约 1 MB）、shiki 的大语法（C++、Emacs Lisp）
			// 与 oniguruma 引擎、mermaid、abcjs。首屏入口不含它们，阈值按其中最大的定
			chunkSizeWarningLimit: 1100,
			rolldownOptions: {
				// 插件耗时统计只是构建性能的参考，每次构建都报一遍
				checks: { pluginTimings: false },
				// 去掉 JSDoc：服务端产物还要经 Nitro 的 rollup 再打包一遍，
				// rollup 读不懂写在 JSDoc 里的 `@__NO_SIDE_EFFECTS__`（@vueuse/shared 的 injectLocal）
				output: { comments: { jsdoc: false } },
			},
		},
		define: {
			/** 在生产环境启用 Vue DevTools */
			// __VUE_PROD_DEVTOOLS__: 'true',
			/** 在生产环境启用 Vue 水合不匹配详情 */
			// __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true',
		},
		optimizeDeps: {
			// @keep-sorted
			include: ['@shikijs/colorized-brackets', '@shikijs/transformers', '@unhead/schema-org/vue', '@vue/devtools-core', '@vue/devtools-kit', 'embla-carousel-autoplay', 'embla-carousel-vue', 'embla-carousel-wheel-gestures', 'es-toolkit/array', 'es-toolkit/math', 'es-toolkit/object', 'es-toolkit/promise', 'es-toolkit/string', 'parse-domain', 'plain-shiki', 'shiki/themes/catppuccin-latte.mjs', 'shiki/themes/one-dark-pro.mjs', 'temporal-polyfill', 'vue-tippy'],
		},
		server: {
			allowedHosts: true,
		},
	},

	// @keep-sorted
	modules: [
		'@bikariya/image-viewer',
		'@bikariya/modals',
		'@bikariya/shiki',
		'@nuxt/hints',
		'@nuxt/icon',
		'@nuxt/image',
		'@nuxtjs/color-mode',
		// 正文的解析与渲染。原先由 @nuxt/content 代为安装，移除它后直接注册
		'@nuxtjs/mdc',
		'@nuxtjs/seo',
		'@pinia/nuxt',
		'@vueuse/nuxt',
		'nuxt-llms',
	],

	colorMode: {
		preference: 'system',
		fallback: 'light',
		classSuffix: '',
	},

	dxup: {
		features: {
			namedLayoutSlots: true,
		},
	},

	hooks: {
		/**
		 * 多语言的前缀版：每个页面（草稿预览除外）各复制一条 `/:lang(en|ja|…)/...` 的路由（name 前加 `lang-`），现有地址不变。
		 * 前缀版的界面是英文，能翻译的内容取 AI 译文，不能翻译的（说说、友链……）照旧是原文。
		 * 候选语言写死在 shared/utils/lang.ts；主题配置没开的语言由 middleware/content-lang.global.ts 回 404
		 */
		'pages:extend': (pages) => {
			const prefix = `/:lang(${CANDIDATE_LANGS.join('|')})`
			for (const page of [...pages]) {
				if (page.file && !/\/pages\/preview\//.test(page.file))
					pages.push({ ...page, name: `lang-${page.name}`, path: page.path === '/' ? prefix : `${prefix}${page.path}` })
			}
		},
		'ready': () => {
			console.info(`
================================
${pascalCase(packageJson.name)} ${packageJson.version}
${packageJson.homepage}
================================
`)
		},
	},

	icon: {
		customCollections: [
			{ prefix: 'zi', dir: './app/assets/icons' },
		],
		clientBundle: {
			scan: {
				globInclude: ['**\/*.{vue,jsx,tsx,ts,md,mdc,mdx}'],
			},
		},
		// 包里没有的图标（站长在主题配置里填的）由服务端去 iconify 取；浏览器不直连 api.iconify.design，不把读者 IP 交出去
		fallbackToApi: 'server-only',
	},

	image: {
		// 尽量以这些密度点对点显示
		densities: [1, 1.5, 2],
		format: ['avif', 'webp'],
	},

	linkChecker: {
		// @keep-sorted
		skipInspections: [
			'no-baseless',
			'no-non-ascii-chars',
			'no-uppercase-chars',
		],
	},

	llms: {
		domain: blogConfig.url,
		title: blogConfig.title,
		description: blogConfig.description,
	},

	ogImage: {
		enabled: false,
	},

	// 正文由服务端按两条路径解析，路径 B 调 parseMarkdown 时自带插件，这里不再配 remark / rehype 插件
	mdc: {
		highlight: false,
	},

	robots: {
		disallow: blogConfig.article.robotsNotIndex,
	},

	// 路由由 @nuxtjs/sitemap 自动收集，mx 里的文章、日记、独立页、专栏、标签由动态源补上。
	// 搜索页是 noindex、会员页因人而异，不进 sitemap
	sitemap: {
		sources: ['/api/__sitemap__/mx'],
		exclude: ['/search', '/membership'],
	},

	site: {
		name: blogConfig.title,
		url: blogConfig.url,
		defaultLocale: blogConfig.language,
	},
})
