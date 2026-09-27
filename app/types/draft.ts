import type { ArticleDetail } from './article'

/** 分享出来的草稿是哪种内容 */
export type DraftKind = 'post' | 'note' | 'page'

/**
 * 草稿预览：`/api/mx/preview/:token` 的返回。
 * 形状与文章详情一致，页面与目录挂件照常用；`article.path` 是预览页自己的地址
 */
export interface DraftPreview extends Pick<ArticleDetail, 'article' | 'body' | 'toc' | 'source'> {
	kind: DraftKind
}
