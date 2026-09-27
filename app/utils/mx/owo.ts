/**
 * 迁移来的 OwO 表情名（Twikoo 的表情图换成了 `:tv_委屈:` 这样的名字）→ Unicode 表情。
 * 纯模块，只在服务端渲染评论正文时用。
 *
 * 表按名字查，前缀（`tv_` 之类的表情包名）不参与：`:tv_委屈:`、`:委屈:` 都是 🥺。
 * 表里没有的：带包名、名字里有汉字的显示成「[委屈]」；不带包名的原样不动（「时间:下午:」这样的半角冒号不能误伤），
 * `12:30:45` 里的 `:30:`、`:root:` 也原样不动
 */
const EMOJI: Record<string, string> = {
	微笑: '🙂',
	笑: '😄',
	大笑: '😆',
	偷笑: '🤭',
	坏笑: '😏',
	奸笑: '😏',
	斜眼笑: '😏',
	笑哭: '😂',
	哈哈: '😄',
	可爱: '😊',
	腼腆: '☺️',
	害羞: '😳',
	亲亲: '😘',
	色: '😍',
	星星眼: '🤩',
	酷: '😎',
	得意: '😎',
	调皮: '😜',
	调侃: '😜',
	吐舌: '😛',
	委屈: '🥺',
	难过: '😞',
	大哭: '😭',
	哭: '😢',
	流泪: '😢',
	伤心: '💔',
	生气: '😠',
	发怒: '😡',
	抓狂: '😫',
	鄙视: '😒',
	白眼: '🙄',
	冷漠: '😑',
	无语: '😑',
	呆: '😐',
	尴尬: '😅',
	流汗: '😓',
	汗: '😓',
	无奈: '😮‍💨',
	思考: '🤔',
	疑问: '❓',
	黑人问号: '🤨',
	惊讶: '😮',
	惊吓: '😱',
	目瞪口呆: '😲',
	晕: '😵',
	灵魂出窍: '👻',
	困: '😪',
	哈欠: '🥱',
	睡着: '😴',
	睡觉: '😴',
	生病: '🤒',
	吐: '🤮',
	呕吐: '🤮',
	吐血: '🤮',
	馋: '🤤',
	流鼻血: '🤤',
	闭嘴: '🤐',
	嘘: '🤫',
	捂脸: '🤦',
	打脸: '🤦',
	凝视: '👀',
	再见: '👋',
	点赞: '👍',
	赞: '👍',
	鼓掌: '👏',
	拜托: '🙏',
	抱拳: '🙏',
	大佬: '🙇',
	发财: '🤑',
	爱心: '❤️',
	心: '❤️',
	玫瑰: '🌹',
	OK: '👌',
	ok: '👌',
	doge: '🐶',
	滑稽: '😏',
}

/** `:包名_名字:` 或 `:名字:`；名字最长 12 个字，不含空白与冒号 */
const OWO = /:([a-z]{1,8}_)?([^\s:]{1,12}):/gi
const HAN = /\p{Script=Han}/u

export function replaceOwo(text: string) {
	if (!text.includes(':'))
		return text
	let out = ''
	let last = 0
	OWO.lastIndex = 0
	for (let match = OWO.exec(text); match; match = OWO.exec(text)) {
		const [, pack, name = ''] = match
		const emoji = EMOJI[name] ?? (pack && HAN.test(name) ? `[${name}]` : undefined)
		if (emoji === undefined) {
			// 不是表情：结尾的冒号留给下一个（`:30:委屈:` 里的 `:委屈:`）
			OWO.lastIndex = match.index + match[0].length - 1
			continue
		}
		out += text.slice(last, match.index) + emoji
		last = OWO.lastIndex
	}
	return out + text.slice(last)
}
