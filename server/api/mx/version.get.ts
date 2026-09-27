/** 侧栏技术信息用的 core 版本；取不到时是空串 */
export default defineEventHandler(async () => ({ core: await getCachedCoreVersion().catch(() => '') }))
