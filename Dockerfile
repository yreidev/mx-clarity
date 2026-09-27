# mx-clarity 的镜像：运行时只要 NUXT_MX_API_URL（core 的内网地址，带 /api/v3）
# 构建与运行都用 glibc 的 node:24-slim（与 CI 相同）：构建产物里 sharp 的二进制是 linux-x64 glibc 的，alpine 跑不了

FROM node:24-slim AS build
WORKDIR /app
# corepack 按 package.json 的 packageManager 装 pnpm，并校验里面写的 sha512
RUN corepack enable
# 安装时的 prepare 脚本要跑 nuxt prepare，需要完整源码，所以先拷全部再装依赖
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	TZ=Asia/Shanghai
# 文件归 root、node 用户只读：主题运行时不写盘（缓存在内存里），进程改不了自己的代码
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
# 只检查主题自己活着：取一个静态文件，不依赖 core（core 没初始化、暂时连不上时主题照样算健康）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/favicon.svg').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]
