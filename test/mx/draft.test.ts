import { describe, expect, it } from 'vitest'
import { isShareToken, loadSharedDraft } from '../../app/utils/mx/draft'
import { classifyMxError } from '../../app/utils/mx/errors'
import { clientWith, fixture, jsonResponse } from './helpers'

/** core 生成的令牌是 24 字节的 base64url，32 位 */
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123-_'

describe('草稿预览', () => {
	it('令牌只收 base64url 字符', () => {
		expect(isShareToken(TOKEN)).toBe(true)
		for (const bad of ['short', '../../posts/x', `${TOKEN}/x`, 'has space inside token!!', 'a'.repeat(129), undefined, 42])
			expect(isShareToken(bad), String(bad)).toBe(false)
	})

	it('夹具：发往 core 的路径带 ts 绕过 15 秒缓存；映射成文章详情的形状、走 Lexical 渲染', async () => {
		const { client, requests } = clientWith(() => jsonResponse(fixture('draft-shared')))
		const draft = await loadSharedDraft(client, TOKEN)
		const url = new URL(requests[0]!.url)
		expect(url.pathname).toBe(`/api/v3/drafts/shared/${TOKEN}`)
		expect(Number(url.searchParams.get('ts'))).toBeGreaterThan(0)
		expect(draft).toMatchObject({
			kind: 'post',
			source: 'lexical',
			article: { title: '示例草稿：一次短途旅行', date: '2022-09-06T11:00:00.000Z', path: `/preview/${TOKEN}`, meta: {} },
		})
		expect(draft.article.readingTime?.words).toBeGreaterThan(500)
		expect(draft.toc?.links.length).toBeGreaterThan(3)
		expect(draft.body.children.length).toBeGreaterThan(10)
	})

	it('没有标题、类型不认识时有兜底', async () => {
		const data = fixture('draft-shared')
		data.data.title = '  '
		data.data.ref_type = 'recently'
		const { client } = clientWith(() => jsonResponse(data))
		expect(await loadSharedDraft(client, TOKEN)).toMatchObject({ kind: 'post', article: { title: '无标题草稿' } })
	})

	it('链接关掉或不存在：core 回 404 DRAFT_SHARE_NOT_FOUND，归为 not-found', async () => {
		const { client } = clientWith(() => jsonResponse(fixture('error-404-draft-share'), { status: 404 }))
		const failure = classifyMxError(await loadSharedDraft(client, TOKEN).catch(error => error))
		expect(failure).toMatchObject({ kind: 'not-found', code: 'DRAFT_SHARE_NOT_FOUND' })
	})
})
