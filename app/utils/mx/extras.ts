import type { BannerType, ContentExtras } from '../../types/article'
import { msg } from '~~/shared/utils/i18n'
import { safeUrl } from './adapter'
/**
 * 文章与日记详情的附加信息：admin 里的预设（`meta.banner`、`meta.aiGen`）与 core 算好的 `$meta`
 * （`summary`、`related`、`skills`）整理成 `ContentExtras`。纯模块，由 server 路由调用。
 * 这些字段有的来自站长、有的来自 core 的 AI，一律当不可信：文字只收字符串、限长，地址过白名单
 */
import { skillNameOfRawUrl } from './skills'

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value: unknown, max: number) {
	if (typeof value !== 'string')
		return undefined
	const trimmed = value.trim()
	return trimmed ? trimmed.slice(0, max) : undefined
}

/** core 的五种 banner 对到提示框的四种样式 */
const BANNER_TYPES: Record<string, BannerType> = { info: 'info', secondary: 'info', success: 'tip', warning: 'warning', error: 'error' }

function bannerOf(value: unknown): ContentExtras['banner'] {
	if (!isObject(value))
		return undefined
	const type = typeof value.type === 'string' ? BANNER_TYPES[value.type] : undefined
	const message = text(value.message, 500)
	// className 是站长填的自由字符串，不透传
	return message ? { type: type ?? 'info', message } : undefined
}

/** core 内置的 aiGen 选项（meta-preset.service.ts） */
const AI_GEN_LABELS: Record<number, string> = {
	[-1]: msg('post.handwritten'),
	0: msg('post.writingAssistance'),
	1: msg('post.polishing'),
	2: msg('post.fullyAiGenerated'),
	3: msg('post.organizing'),
	4: msg('post.title'),
	5: msg('post.proofreading'),
	6: msg('post.inspiration'),
	7: msg('post.rewriting'),
	8: msg('post.aiImages'),
	9: msg('post.dictation'),
}

function aiGenOf(value: unknown): ContentExtras['aiGen'] {
	const values = (Array.isArray(value) ? value : [value]).slice(0, 12)
	const labels: string[] = []
	let handcrafted = false
	let full = false
	for (const item of values) {
		if (typeof item === 'number' && AI_GEN_LABELS[item]) {
			handcrafted ||= item === -1
			full ||= item === 2
			labels.push(AI_GEN_LABELS[item])
		}
		// 站长自定义的选项（allowCustomOption）存成字符串
		else if (typeof item === 'string' && item.trim() && labels.length < 5) {
			labels.push(item.trim().slice(0, 20))
		}
	}
	if (!labels.length)
		return undefined
	return { labels: [...new Set(labels)].slice(0, 5), handcrafted: handcrafted && !full && labels.length === 1, full }
}

function relatedOf(value: unknown): ContentExtras['related'] {
	if (!Array.isArray(value))
		return undefined
	const related = value.slice(0, 10).flatMap((item) => {
		if (!isObject(item))
			return []
		const title = text(item.title, 200)
		const slug = text(item.slug, 200)
		const category = isObject(item.category) ? text(item.category.slug, 200) : undefined
		if (!title || !slug || !category)
			return []
		const summary = text(item.summary, 200)
		return [{ title, path: `/posts/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`, ...(summary ? { summary } : {}) }]
	})
	return related.length ? related : undefined
}

function skillsOf(value: unknown): ContentExtras['skills'] {
	if (!Array.isArray(value))
		return undefined
	const skills = value.slice(0, 10).flatMap((item) => {
		if (!isObject(item))
			return []
		const name = text(item.name, 100)
		if (!name)
			return []
		// 本站的 Skill 页（`/skills/<名称>`）；认不出名称时退回 core 的原文地址
		const slug = skillNameOfRawUrl(item.rawUrl)
		const url = slug ? `/skills/${slug}` : safeUrl(item.rawUrl)
		return [{ name, description: text(item.description, 300) ?? '', ...(url ? { url } : {}) }]
	})
	return skills.length ? skills : undefined
}

export interface ExtrasOptions {
	/** 付费文章锁着：AI 摘要是按全文生成的，不给 */
	locked?: boolean
}

export function contentExtrasOf(meta: unknown, $meta: unknown, options: ExtrasOptions = {}): ContentExtras | undefined {
	const presets = isObject(meta) ? meta : {}
	const computed = isObject($meta) ? $meta : {}
	const summary = options.locked || !isObject(computed.summary) ? undefined : text(computed.summary.text, 1000)
	const extras: ContentExtras = {
		banner: bannerOf(presets.banner),
		aiGen: aiGenOf(presets.aiGen),
		aiSummary: summary,
		related: relatedOf(computed.related),
		skills: skillsOf(computed.skills),
		// core 的 hasInLocale 不看付费墙、不校验 hash：锁着时不给入口，取不到的由接口说「暂无」
		insights: !options.locked && isObject(computed.insights) && computed.insights.hasInLocale === true ? true : undefined,
		tts: !options.locked && isObject(computed.tts) && computed.tts.available === true ? { stale: computed.tts.stale === true } : undefined,
	}
	const present = Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined)) as ContentExtras
	return Object.keys(present).length ? present : undefined
}
