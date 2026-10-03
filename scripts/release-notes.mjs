/**
 * GitHub Release 的正文：CHANGELOG.md 里这一版的一节，开头那句总结之后插上拉镜像的命令，小节标题升一级。
 * 镜像工作流（.github/workflows/docker.yml）推完镜像后用它发 Release；发版前在本地跑一遍预览。
 *
 *   node scripts/release-notes.mjs v1.2.3 > notes.md
 *
 * 标签与 package.json 的版本对不上、CHANGELOG 里没有这一版、这一节开头没有总结，都直接失败。
 * RELEASE_IMAGES：空格分隔的镜像名（不带标签），默认 Docker Hub 与 ghcr 各一个
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEFAULT_IMAGES = ['yreidev/mx-clarity', 'ghcr.io/yreidev/mx-clarity']

/** `v1.2.3`、`v1.2.3-rc.1` → 去掉 v 的版本号；格式不对是 undefined */
export function versionOfTag(tag) {
	return /^v(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag ?? '')?.[1]
}

/** CHANGELOG 里 `## [1.2.3] - 日期` 这一节的正文（不含标题行）；没有这一节是 undefined */
export function changelogSection(changelog, version) {
	const section = changelog.split(/^(?=## )/m).find(part => part.startsWith(`## [${version}]`))
	return section?.replace(/^.*\n?/, '').trim()
}

function imageBlock(version, images) {
	const prerelease = version.includes('-')
	const minor = version.split('.').slice(0, 2).join('.')
	const pulls = images.map(image => `docker pull ${image}:${version}`).join('\n# 或\n')
	const tags = prerelease
		? `标签：只有 \`${version}\`（预发布，不打 \`latest\` 与 \`${minor}\`）`
		: `标签：\`latest\`、\`${version}\`、\`${minor}\`；\`edge\` 跟着 \`main\``
	return `## 镜像\n\n\`\`\`bash\n${pulls}\n\`\`\`\n\n${tags}。只有 \`linux/amd64\`。`
}

/** 拼出 Release 正文；出错时抛出，消息直接给人看 */
export function releaseNotes({ tag, packageVersion, changelog, images = DEFAULT_IMAGES }) {
	const version = versionOfTag(tag)
	if (!version)
		throw new Error(`标签格式不对：${tag}（应为 v1.2.3 或 v1.2.3-rc.1）`)
	if (packageVersion !== version)
		throw new Error(`package.json 的版本是 ${packageVersion}，标签是 ${tag}`)
	const section = changelogSection(changelog, version)
	if (!section)
		throw new Error(`CHANGELOG.md 里没有 ${version} 这一节（标题写成 ## [${version}] - YYYY-MM-DD）`)
	const [summary, ...rest] = section.split(/\n{2,}/)
	if (/^[#\-*>|`]/.test(summary))
		throw new Error(`CHANGELOG.md 的 ${version} 这一节开头要有一段总结，再接小节`)
	// CHANGELOG 里版本是二级标题、小节是三级；Release 正文里小节当二级
	const details = rest.join('\n\n').replace(/^#(#{2,}) /gm, '$1 ')
	return `${[summary, imageBlock(version, images), details].filter(Boolean).join('\n\n')}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
	const images = process.env.RELEASE_IMAGES?.split(/\s+/).filter(Boolean)
	try {
		process.stdout.write(releaseNotes({
			tag: process.argv[2],
			packageVersion: JSON.parse(read('package.json')).version,
			changelog: read('CHANGELOG.md'),
			images: images?.length ? images : undefined,
		}))
	}
	catch (error) {
		process.stderr.write(`${error.message}\n`)
		process.exit(1)
	}
}
