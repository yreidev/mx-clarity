import { renderMarkdownBody } from '~~/app/utils/mx/body'
import { parseSkillMarkdown, rewriteSkillLinks, SKILL_NAME } from '~~/app/utils/mx/skills'

/**
 * core 的 `/s/sk/<名称>/SKILL.md`（公开的 snippet，原样返回 markdown），全站缓存 5 分钟；取不到是 null。
 * 只缓存取到的：名字由访客随便填，查不到的也存的话能把缓存塞满。没命中时转发访客 IP，
 * 拿不存在的名字刷，core 的限流落在刷的人身上，不落在主题的 IP 上
 */
const getCachedSkill = defineCachedFunction(
	async (name: string, ip?: string) => {
		const text = await $fetch<string>(`${useRuntimeConfig().mxApiUrl}/s/sk/${encodeURIComponent(name)}/SKILL.md`, {
			responseType: 'text',
			timeout: 5000,
			retry: 0,
			headers: ip ? { 'x-forwarded-for': ip } : undefined,
		}).catch((error: unknown) => {
			if (isCoreFetchFailure(error))
				noteCoreFailure({ kind: 'unavailable' })
			return undefined
		})
		return typeof text === 'string' && text.length <= 200_000 ? text : null
	},
	{ name: 'mx-skill', maxAge: 300, getKey: (name: string, _ip?: string) => name, validate: entry => typeof entry.value === 'string' },
)

/** Skill 详情：名称、说明、按路径 B 渲染好的正文（相对链接改写到附件转发）、原文地址 */
export default defineEventHandler(async (event) => {
	const name = getRouterParam(event, 'name') ?? ''
	if (!SKILL_NAME.test(name))
		throw notFound()
	const text = await getCachedSkill(name, visitorIpOf(event))
	if (!text)
		throw notFound()
	const parsed = parseSkillMarkdown(text)
	const { body } = await renderMarkdownBody(parsed.body)
	return {
		slug: name,
		name: parsed.name || name,
		description: parsed.description ?? '',
		body: rewriteSkillLinks(body, name),
		raw: `/skills/${name}/SKILL.md`,
	}
})
