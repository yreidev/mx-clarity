import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changelogSection, releaseNotes, versionOfTag } from '../../scripts/release-notes.mjs'

const CHANGELOG = `# 更新日志

说明里提到 \`## [1.0.0] - YYYY-MM-DD\` 不算一节。

## [1.1.0-rc.1] - 2026-10-05

预发布的总结。

### 看得到的变化

- 新东西

## [1.0.1] - 2026-10-04

修了一个问题。

### 修复

- 某处不再报错

#### 细节

更细的说明

## [1.0.0] - 2026-10-01

第一版。
`

const images = ['me/theme', 'ghcr.io/me/theme']

describe('release-notes', () => {
	it('只认 v 开头的完整版本号', () => {
		expect(versionOfTag('v1.2.3')).toBe('1.2.3')
		expect(versionOfTag('v1.2.3-rc.1')).toBe('1.2.3-rc.1')
		expect(versionOfTag('1.2.3')).toBeUndefined()
		expect(versionOfTag('v1.2')).toBeUndefined()
		expect(versionOfTag(undefined)).toBeUndefined()
	})

	it('按标题取出一节，不含标题行，到下一节为止', () => {
		expect(changelogSection(CHANGELOG, '1.0.0')).toBe('第一版。')
		expect(changelogSection(CHANGELOG, '1.0.1')).toMatch(/^修了一个问题。[\s\S]*更细的说明$/)
		expect(changelogSection(CHANGELOG, '1.0')).toBeUndefined()
	})

	it('总结之后插镜像，小节标题升一级', () => {
		const notes = releaseNotes({ tag: 'v1.0.1', packageVersion: '1.0.1', changelog: CHANGELOG, images })
		expect(notes).toBe(`修了一个问题。

## 镜像

\`\`\`bash
docker pull me/theme:1.0.1
# 或
docker pull ghcr.io/me/theme:1.0.1
\`\`\`

标签：\`latest\`、\`1.0.1\`、\`1.0\`；\`edge\` 跟着 \`main\`。只有 \`linux/amd64\`。

## 修复

- 某处不再报错

### 细节

更细的说明
`)
	})

	it('预发布不写 latest 与次版本标签', () => {
		const notes = releaseNotes({ tag: 'v1.1.0-rc.1', packageVersion: '1.1.0-rc.1', changelog: CHANGELOG, images })
		expect(notes).toContain('标签：只有 `1.1.0-rc.1`（预发布，不打 `latest` 与 `1.1`）')
	})

	it('标签、package.json、CHANGELOG 对不上时失败', () => {
		expect(() => releaseNotes({ tag: '1.0.1', packageVersion: '1.0.1', changelog: CHANGELOG })).toThrow('标签格式不对')
		expect(() => releaseNotes({ tag: 'v1.0.2', packageVersion: '1.0.1', changelog: CHANGELOG })).toThrow('package.json 的版本是 1.0.1')
		expect(() => releaseNotes({ tag: 'v1.0.2', packageVersion: '1.0.2', changelog: CHANGELOG })).toThrow('没有 1.0.2 这一节')
		expect(() => releaseNotes({ tag: 'v2.0.0', packageVersion: '2.0.0', changelog: '## [2.0.0] - 2026-10-06\n\n### 修复\n\n- x\n' })).toThrow('开头要有一段总结')
	})

	it('仓库里的 CHANGELOG 有当前版本的一节', () => {
		const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
		const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
		expect(() => releaseNotes({ tag: `v${pkg.version}`, packageVersion: pkg.version, changelog })).not.toThrow()
	})
})
