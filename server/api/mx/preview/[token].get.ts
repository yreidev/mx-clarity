import type { DraftPreview } from '~~/app/types/draft'
import { isShareToken, loadSharedDraft } from '~~/app/utils/mx/draft'
import { classifyMxError } from '~~/app/utils/mx/errors'
import { msg } from '~~/shared/utils/i18n'

/**
 * 草稿预览。**不缓存**、`private, no-store`：链接就是凭证，内容是没发布的；
 * 另加 `X-Robots-Tag` 不让收录。转发访客 IP
 */
export default defineEventHandler(async (event): Promise<DraftPreview> => {
	setHeader(event, 'cache-control', 'private, no-store')
	setHeader(event, 'x-robots-tag', 'noindex, nofollow')
	const gone = () => createError({ statusCode: 404, statusMessage: 'Not Found', message: msg('common.previewLinkDoesnt') })
	const token = getRouterParam(event, 'token')
	if (!isShareToken(token))
		throw gone()
	try {
		return await loadSharedDraft(useServerMxClient(event), token)
	}
	catch (error) {
		if (classifyMxError(error).kind === 'not-found')
			throw gone()
		throw toHttpError(error)
	}
})
