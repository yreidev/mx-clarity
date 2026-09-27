/**
 * 语言建议条的文案：用**目标语言**写（读者还没切过去，要让他看得懂），与界面语言无关，所以不放在 locales 里。
 * 键是内容语言（中文与九种候选语言都有）
 */
export interface LangSuggestionCopy {
	message: string
	accept: string
	later: string
	never: string
}

export const LANG_SUGGESTION_COPY: Record<string, LangSuggestionCopy> = {
	zh: { message: '本站提供中文版', accept: '切换到中文', later: '暂不', never: '不再提示' },
	en: { message: 'This site is available in English', accept: 'Switch to English', later: 'Not now', never: 'Don\'t show again' },
	ja: { message: 'このサイトは日本語でもご覧いただけます', accept: '日本語に切り替える', later: '今はしない', never: '今後表示しない' },
	ko: { message: '이 사이트는 한국어로도 제공됩니다', accept: '한국어로 전환', later: '나중에', never: '다시 보지 않기' },
	fr: { message: 'Ce site est disponible en français', accept: 'Passer au français', later: 'Pas maintenant', never: 'Ne plus afficher' },
	de: { message: 'Diese Website ist auch auf Deutsch verfügbar', accept: 'Auf Deutsch wechseln', later: 'Nicht jetzt', never: 'Nicht mehr anzeigen' },
	es: { message: 'Este sitio está disponible en español', accept: 'Cambiar a español', later: 'Ahora no', never: 'No volver a mostrar' },
	ru: { message: 'Этот сайт доступен на русском языке', accept: 'Перейти на русский', later: 'Не сейчас', never: 'Больше не показывать' },
	pt: { message: 'Este site está disponível em português', accept: 'Mudar para português', later: 'Agora não', never: 'Não mostrar novamente' },
	it: { message: 'Questo sito è disponibile in italiano', accept: 'Passa all\'italiano', later: 'Non ora', never: 'Non mostrare più' },
}
