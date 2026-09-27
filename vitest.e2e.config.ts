import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 页面级测试：要先 pnpm build。每个文件自己起假 core 与构建好的主题，文件之间按顺序跑
export default defineConfig({
	resolve: {
		alias: { '~~': fileURLToPath(new URL('.', import.meta.url)) },
	},
	test: {
		include: ['test/e2e/**/*.e2e.ts'],
		environment: 'node',
		fileParallelism: false,
		testTimeout: 60_000,
		hookTimeout: 60_000,
	},
})
