import { defineNuxtModule } from 'nuxt/kit'

/**
 * 只在开发模式生效，生产构建里没有这段：用 http://<局域网 IP>:端口 访问 dev 时不是安全上下文，
 * 浏览器不提供 crypto.randomUUID，@nuxt/a11y 的开发工具会因此让整页报 500。用所有环境都有的 getRandomValues 补上
 */
const RANDOM_UUID_POLYFILL = `if(!crypto.randomUUID)crypto.randomUUID=()=>'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16))`

export default defineNuxtModule({
	meta: {
		name: 'lan-preview',
	},
	setup(_options, nuxt) {
		if (!nuxt.options.dev)
			return
		const scripts = nuxt.options.app.head.script ??= []
		scripts.unshift({ innerHTML: RANDOM_UUID_POLYFILL, tagPosition: 'head' })
	},
})
