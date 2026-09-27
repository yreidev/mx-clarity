/**
 * 界面文字（与 Yohaku 同一种做法）：源码里只写英文 id（`comment.send`），文字在 shared/locales/<语言>/<命名空间>.json。
 * 查的是：源码里的 id 都在中文表里、中文表里没有用不到的；四种语言的 id 一样多、占位一致；界面层里没有没包 t() 的中文
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../shared/locales/en'
import ja from '../../shared/locales/ja'
import ko from '../../shared/locales/ko'
import zh from '../../shared/locales/zh'

const ROOT = new URL('../../', import.meta.url).pathname

function walk(dir: string, match: RegExp): string[] {
	return readdirSync(join(ROOT, dir)).flatMap((name) => {
		const path = join(dir, name)
		return statSync(join(ROOT, path)).isDirectory() ? walk(path, match) : match.test(name) ? [path] : []
	})
}

const SOURCES = [...walk('app', /\.(?:vue|ts)$/), ...walk('server', /\.ts$/), ...walk('shared', /\.ts$/), 'blog.config.ts'].filter(file => !file.startsWith('shared/locales/'))
const UI_LAYER = /^app\/(?:components|pages|layouts|composables|error\.vue|app\.vue)/
const ID = /^[a-z]+\.[a-z][\dA-Z]*$/i
const CALL = /\b(?:t\(|msg\(|translate\([^,()]+,)\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g
const HAN = /[\u3400-\u9FFF\uFF01-\uFF5E\u3000-\u303F]/

function stripComments(code: string) {
	return code.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

type Message = string | { one: string, other: string }
const flatten = (namespaces: Record<string, Record<string, Message>>) => Object.fromEntries(Object.entries(namespaces).flatMap(([ns, table]) => Object.entries(table).map(([id, message]) => [`${ns}.${id}`, message])))
const CATALOGS = { zh: flatten(zh), en: flatten(en), ja: flatten(ja), ko: flatten(ko) }

const used = new Map<string, string>()
const notIds: string[] = []
for (const file of SOURCES) {
	for (const match of stripComments(readFileSync(join(ROOT, file), 'utf8')).matchAll(CALL)) {
		if (match[1] === '`' && match[2]!.includes('${'))
			continue
		if (ID.test(match[2]!))
			used.set(match[2]!, file)
		else
			notIds.push(`${file}: ${match[2]}`)
	}
}

const texts = (message: Message) => (typeof message === 'string' ? [message] : [message.one, message.other])
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')

/** 界面层里允许出现的中文（不是界面文字的：比对站长数据、控制台日志、给开发者看的报错），`文件: [片段]` */
const ALLOWED: Record<string, string[]> = {
	// 比对站长在主题配置里建的组名（主题自己补的那组已经过 t()）
	'app/components/blog/BlogFooter.vue': ['group.title === \'信息\''],
	// 控制台日志、给开发者看的报错：读者看不到
	'app/components/content/MusicScore.vue': ['无法连接 SoundFonts，不启用播放能力'],
	'app/composables/useMxComments.ts': ['登录地址不对', '评论组件必须放在 PostComment 里'],
	'app/composables/useCore.ts': ['useCoreClient() 只在浏览器里用；服务端取数用 useServerMxClient'],
	'app/composables/useMxMembership.ts': ['支付地址不对'],
}

describe('界面文字', () => {
	it('源码里的 t() / msg() / translate() 只写 id，每个 id 都在中文表里', () => {
		expect(notIds).toEqual([])
		expect([...used].filter(([id]) => !Object.hasOwn(CATALOGS.zh, id)).map(([id, file]) => `${file}: ${id}`)).toEqual([])
	})

	it('中文表里没有用不到的 id', () => {
		expect(Object.keys(CATALOGS.zh).filter(id => !used.has(id))).toEqual([])
	})

	it.each(['en', 'ja', 'ko'] as const)('%s 与中文的 id 一样多、占位一致，没有空的译文', (lang) => {
		const catalog = CATALOGS[lang]
		expect(Object.keys(catalog).sort()).toEqual(Object.keys(CATALOGS.zh).sort())
		const bad = Object.entries(catalog).flatMap(([id, message]) => {
			const expected = placeholders(texts(CATALOGS.zh[id]!)[0]!)
			return texts(message).filter(text => !text.trim() || placeholders(text) !== expected || (lang !== 'ja' && HAN.test(text))).map(text => `${id} → ${text}`)
		})
		expect(bad).toEqual([])
	})

	it('界面层里没有没包 t() 的中文', () => {
		const leftovers: string[] = []
		for (const file of SOURCES.filter(path => UI_LAYER.test(path))) {
			let code = stripComments(readFileSync(join(ROOT, file), 'utf8')).replace(/<style[\s\S]*?<\/style>/g, '')
			for (const snippet of ALLOWED[file] ?? [])
				code = code.split(snippet).join('')
			code.split('\n').forEach((line, index) => {
				if (HAN.test(line))
					leftovers.push(`${relative(ROOT, join(ROOT, file))}:${index + 1}: ${line.trim().slice(0, 80)}`)
			})
		}
		expect(leftovers).toEqual([])
	})
})
