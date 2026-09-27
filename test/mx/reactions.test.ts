import { describe, expect, it } from 'vitest'
import { articleFromPost, noteFromModel } from '../../app/utils/mx/adapter'
import { classifyMxError } from '../../app/utils/mx/errors'
import { likeContent, reactionErrorOf, voteThinking } from '../../app/utils/mx/reactions'
import { clientWith, fixture, jsonResponse } from './helpers'

const pathOf = (request: Request) => new URL(request.url).pathname

function errorResponse(status: number, code: string) {
	return jsonResponse({ error: { code, message: 'irrelevant' } }, { status })
}

describe('点赞', () => {
	it('发给 core 的路径与请求体；计入了返回 counted', async () => {
		const { client, requests } = clientWith(() => jsonResponse({ data: { ok: true } }))
		expect(await likeContent(client, 'note', '42')).toEqual({ counted: true })
		expect([requests[0]!.method, pathOf(requests[0]!)]).toEqual(['POST', '/api/v3/activity/like'])
		expect(await requests[0]!.json()).toEqual({ type: 'note', id: '42' })
	})

	it('同一 IP 已经赞过（400 ALREADY_SUPPORTED，实测）也算成功，只是没计入', async () => {
		const { client } = clientWith(() => errorResponse(400, 'ALREADY_SUPPORTED'))
		expect(await likeContent(client, 'post', '1')).toEqual({ counted: false })
	})

	it('别的错误照常抛，提示只用固定文案', async () => {
		const failureOf = async (status: number, code: string) => {
			const { client } = clientWith(() => errorResponse(status, code))
			return classifyMxError(await likeContent(client, 'post', '1').catch(error => error))
		}
		// 赞一篇不存在的，core 回 500（实测）
		expect(reactionErrorOf(await failureOf(500, 'INTERNAL_ERROR'))).toEqual({ statusCode: 503, message: '暂时点不了，请稍后再试' })
		expect(reactionErrorOf(await failureOf(429, 'RATE_LIMITED')).statusCode).toBe(429)
		expect(reactionErrorOf(await failureOf(422, 'VALIDATION_FAILED')).statusCode).toBe(400)
	})

	it('文章、日记带上赞数（夹具经 api-client 转换）', async () => {
		const post = fixture('post-lexical-media')
		post.data.like_count = 3
		const note = fixture('note-detail')
		note.data.like_count = 7
		const { client } = clientWith(request => jsonResponse(pathOf(request).startsWith('/api/v3/posts') ? post : note))
		expect(articleFromPost(await client.post.getPost('x', 'y')).likeCount).toBe(3)
		expect(noteFromModel(await client.note.getNoteById(2)).likeCount).toBe(7)
	})
})

describe('碎碎念的赞 / 踩', () => {
	it('用 POST（不用会改数据的 GET 别名），赞是 0、踩是 1；投完带 ts 重新取计数', async () => {
		const item = fixture('recently-item')
		item.data.up = 5
		item.data.down = 2
		const { client, requests } = clientWith(request => request.method === 'POST' ? jsonResponse({ data: { code: 1 } }) : jsonResponse(item))
		expect(await voteThinking(client, '184833891280883712', 'down')).toEqual({ attitude: 'down', up: 5, down: 2 })
		const [post, get] = requests
		expect([post!.method, pathOf(post!), new URL(post!.url).searchParams.get('attitude')]).toEqual(['POST', '/api/v3/recently/attitude/184833891280883712', '1'])
		expect([get!.method, pathOf(get!)]).toEqual(['GET', '/api/v3/recently/184833891280883712'])
		expect(Number(new URL(get!.url).searchParams.get('ts'))).toBeGreaterThan(0)
	})

	it('code -1（再投同一个 = 撤销，实测）时本人没有态度', async () => {
		const { client } = clientWith(request => request.method === 'POST' ? jsonResponse({ data: { code: -1 } }) : jsonResponse(fixture('recently-item')))
		expect(await voteThinking(client, '1', 'up')).toEqual({ attitude: null, up: 0, down: 0 })
	})

	it('计数不是非负整数时按 0', async () => {
		const item = fixture('recently-item')
		item.data.up = -3
		item.data.down = '7'
		const { client } = clientWith(request => request.method === 'POST' ? jsonResponse({ data: { code: 1 } }) : jsonResponse(item))
		expect(await voteThinking(client, '1', 'up')).toMatchObject({ up: 0, down: 0 })
	})
})
