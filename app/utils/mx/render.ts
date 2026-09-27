import type { UiLang } from '~~/shared/utils/i18n'
/**
 * 正文渲染的分发：`contentFormat === 'lexical'` 且 `content` 能解析 → 路径 A，否则路径 B。
 */
import type { RenderedBody } from './body'
import { renderMarkdownBody } from './body'
import { applyLinkPreviews, previewLookupOf } from './enrichment'
import { parseLexicalState, renderLexicalBody } from './lexical'
import { applyImageMeta, imageMetaTableOf, staticPolls } from './rich-blocks'

export type BodySource = 'lexical' | 'markdown'

/** 文章、日记、独立页都有这几个字段（contentFormat / content / text，以及 core 给 markdown 文档算的 images） */
interface RenderableModel {
	contentFormat?: string
	content?: string | null
	text?: string | null
	images?: unknown
}

export interface RenderOptions {
	/** `$meta.enrichments`：给单独成段的链接、链接卡片补上标题与描述（净化见 enrichment.ts） */
	enrichments?: unknown
	/** 能不能投票：草稿预览、解锁后的加密日记里 core 找不到投票，传 false 换成静态列表 */
	polls?: boolean
	/** 正文里主题生成的文字（占位、链接卡片的属性名……）用哪种界面语言：按取数的语言（`uiLangOfClient`），不给是中文 */
	ui?: UiLang
}

export async function renderPostBody(post: RenderableModel, options: RenderOptions = {}): Promise<RenderedBody & { source: BodySource }> {
	const state = post.contentFormat === 'lexical' ? parseLexicalState(post.content) : undefined
	const ui = options.ui ?? 'zh'
	if (state) {
		const rendered = await renderLexicalBody(state, ui)
		applyLinkPreviews(rendered.body, previewLookupOf(options.enrichments, ui))
		if (options.polls === false)
			staticPolls(rendered.body, ui)
		return { ...rendered, source: 'lexical' }
	}
	const rendered = await renderMarkdownBody(post.text ?? '', ui)
	// markdown 文档的图片元数据在文档级的 images 里（Lexical 的在节点上）
	applyImageMeta(rendered.body, imageMetaTableOf(post.images))
	applyLinkPreviews(rendered.body, previewLookupOf(options.enrichments, ui))
	return { ...rendered, source: 'markdown' }
}
