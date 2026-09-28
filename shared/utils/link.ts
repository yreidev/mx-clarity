import { fromUrl, parseDomain, ParseResultType } from 'parse-domain'
import { isPathFile } from 'site-config-stack/urls'
import { msg } from './i18n'

const domainTip: Record<string, string> = {
	'github.io': msg('friends.githubPagesDomain'),
	'netlify.app': msg('friends.netlifyDomain'),
	'pages.dev': msg('friends.cloudflareDomain'),
	'vercel.app': msg('friends.vercelDomain'),
	'zeabur.app': msg('friends.zeaburDomain'),
}

export function getDomain(url: string) {
	const domain = fromUrl(url)
	return typeof domain === 'symbol' ? url : domain
}

export function getMainDomain(url: string, useIcann?: boolean) {
	const hostname = getDomain(url)
	const parseResult = parseDomain(hostname)
	if (parseResult.type !== ParseResultType.Listed)
		return hostname
	const { domain, topLevelDomains } = useIcann ? parseResult.icann : parseResult
	return `${domain}.${topLevelDomains.join('.')}`
}

export function getDomainType(mainDomain: string) {
	return domainTip[mainDomain]
}

const githubUsernameRegex = /github\.com\/([a-zA-Z0-9-]+)(?:\/[^/]+)?(\/?)$/

export function getGithubUsername(url?: string) {
	if (!url)
		return ''
	return url.match(githubUsernameRegex)?.[1] ?? ''
}

export function isExtLink(url?: string) {
	return url
		? url.includes(':') || url.startsWith('//') || !!isPathFile(url)
		: false
}

export function safelyDecodeUriComponent(str: string) {
	try {
		return decodeURIComponent(str)
	}
	catch {
		return str
	}
}

/** 静态托管添加的尾斜杠不应改变页面身份或 Content 缓存键。 */
export function normalizeContentPath(path: string) {
	return path.replace(/\/+$/, '') || '/'
}
