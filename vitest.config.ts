import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 测试都是纯模块测试（app/utils/mx/** 不依赖 Nuxt 运行时），不需要 @nuxt/test-utils
export default defineConfig({
	resolve: {
		// shared/utils 按 Nuxt 的写法引用 ~~/blog.config
		alias: { '~~': fileURLToPath(new URL('.', import.meta.url)) },
	},
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
	},
})
