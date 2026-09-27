/**
 * 内容功能：服务端渲染的页面里看得到公告、AI 声明与摘要、过时提醒、相关文章、Skill、
 * 日记封面、碎碎念的引用与情境、专栏描述、分类页、日期式日记地址；带昵称的提及（§27.1）
 */
import type { FakeCore } from './fake-core'
import type { ThemeServer } from './harness'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startFakeCore } from './fake-core'
import { startTheme } from './harness'

let core: FakeCore
let theme: ThemeServer

beforeAll(async () => {
	core = await startFakeCore({ theme: { timeZone: 'Asia/Shanghai' } })
	theme = await startTheme(core.apiUrl)
})

afterAll(async () => {
	await theme?.close()
	await core?.close()
})

const html = (path: string) => fetch(`${theme.url}${path}`).then(res => res.text())

describe('文章详情', () => {
	let page: string
	beforeAll(async () => {
		page = await html('/posts/tech/mx-syntax-sample')
	})

	it('公告、AI 参与声明、过时提醒、AI 摘要都在；公告的 className 不进页面', () => {
		expect(page).toContain('示例公告：这是站长设在文章上的提示。')
		expect(page).toContain('AI 参与：润色、校对')
		expect(page).toMatch(/这篇文章最后更新于 \d+ 天前/)
		expect(page).toContain('这是一段示例的 AI 摘要。')
		// 整个 meta 会进水合数据，但 className 不许渲染成 class
		expect(page).not.toMatch(/class="[^"]*evil/)
	})

	it('文末有相关文章与 Skill 列表', () => {
		expect(page).toContain('href="/posts/tech/xss-probe"')
		expect(page).toContain('相关的示例文章')
		expect(page).toContain('demo-skill')
		// 进本站的 Skill 页，不直接给 core 的原文件
		expect(page).toContain('href="/skills/demo"')
	})

	it('带昵称的提及合成一个链接；分类名链到分类页', () => {
		expect(page).toContain('aria-label="示例（GitHub 用户 octocat）"')
		expect(page).not.toMatch(/<span>示例<\/span><a[^>]*github\.com\/octocat/)
		expect(page).toMatch(/<a[^>]*href="\/posts\/tech"[^>]*class="[^"]*post-category/)
	})
})

describe('日记', () => {
	it('日记有封面与 AI 摘要，不提醒过时', async () => {
		const page = await html('/notes/2')
		expect(page).toContain('https://example.com/note-cover.png')
		expect(page).toMatch(/<meta[^>]*property="og:image"[^>]*note-cover\.png/)
		expect(page).toContain('示例日记的 AI 摘要。')
		expect(page).not.toContain('可能已过时')
	})

	it('日期加 slug 的地址 301 到 /notes/:nid；不合格的是 404', async () => {
		const res = await fetch(`${theme.url}/notes/2022/5/1/hello`, { redirect: 'manual' })
		expect(res.status).toBe(301)
		expect(res.headers.get('location')).toBe('/notes/2')
		expect((await fetch(`${theme.url}/notes/2022/13/1/hello`)).status).toBe(404)
	})
})

describe('碎碎念与专栏', () => {
	it('碎碎念显示引用的日记、companion 的情境、评论入口', async () => {
		const page = await html('/thinking')
		expect(page).toMatch(/<a[^>]*href="\/notes\/2"[^>]*class="[^"]*thinking-ref/)
		// 窗口标题跟主题配置 liveDesk.showWindowTitle 走，默认不显示
		expect(page).toContain('VS Code')
		expect(page).not.toContain('README.md')
		expect(page).toContain('示例曲目 - 示例歌手')
		expect(page).toMatch(/href="\/thinking\/\d+#comments"/)
	})

	it('专栏的描述按 markdown 渲染', async () => {
		// 服务端输出里文字两边夹着 Vue 的片段注释
		expect(await html('/notes/series/sample-topic')).toMatch(/<strong>(?:<!--\[-->)?加粗/)
	})
})

describe('分类独立页', () => {
	it('分类名做标题，文章按年列出；没有的分类 404', async () => {
		const res = await fetch(`${theme.url}/posts/tech`)
		expect(res.status).toBe(200)
		const page = await res.text()
		expect(page).toMatch(/<h1[^>]*>[\s\S]*技术[\s\S]*<\/h1>/)
		expect(page).toContain('篇文章')
		expect(page).toContain('class="category-year-title"')
		expect((await fetch(`${theme.url}/posts/no-such-category`)).status).toBe(404)
	})
})
