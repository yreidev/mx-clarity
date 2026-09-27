import { SKILL_NAME, skillAssetPathOf } from '~~/app/utils/mx/skills'

/**
 * Skill 的附件（与 SKILL.md 本身）转发：`/skills/<名称>/<路径>` → core 的 `/s/sk/<名称>/<路径>`。
 * 路径每段都要像文件名（不许 `.`、`..`、`#?\\`）；HTML、SVG 一律按纯文本给（同源执行不得）；浏览器缓存 5 分钟。
 * 转发访客 IP：拿不存在的地址刷，core 的限流落在刷的人身上，不落在主题的 IP 上
 */
const SAFE_TYPES = /^(?:text\/(?:plain|markdown|csv)|application\/(?:json|pdf|zip|octet-stream)|image\/(?:png|jpeg|gif|webp|avif))$/

export default defineEventHandler(async (event) => {
	const name = getRouterParam(event, 'name') ?? ''
	const path = skillAssetPathOf(getRouterParam(event, 'path'))
	if (!SKILL_NAME.test(name) || !path)
		throw notFound()
	const ip = visitorIpOf(event)
	const res = await fetch(`${useRuntimeConfig().mxApiUrl}/s/sk/${encodeURIComponent(name)}/${path.split('/').map(encodeURIComponent).join('/')}`, {
		redirect: 'error',
		signal: AbortSignal.timeout(5000),
		headers: ip ? { 'x-forwarded-for': ip } : undefined,
	}).catch(() => undefined)
	if (!res?.ok || !res.body)
		throw notFound()
	const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
	setHeaders(event, {
		'content-type': SAFE_TYPES.test(type) ? (type.startsWith('text/') ? `${type}; charset=utf-8` : type) : 'text/plain; charset=utf-8',
		'cache-control': 'public, max-age=300',
		'x-content-type-options': 'nosniff',
		'content-security-policy': 'default-src \'none\'',
	})
	return res.body
})
