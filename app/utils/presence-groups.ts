import type { UiLang } from '~~/shared/utils/i18n'
import { translate } from '~~/shared/utils/i18n'
/**
 * 阅读位置的分组：挨得近的人合成一组，免得圆点叠在一起。纯函数。
 * 阈值（百分比）= max(18px, 轨道高度 / 10) 换算成占轨道的百分之几；按位置排好，和组里第一个人相差不超过阈值的并进来，
 * 组的位置取平均，组的键取组里标识排序后的第一个（组员不变时键就不变，圆点不会闪）
 */
export interface PresenceReader {
	identity: string
	position: number
	name: string
}

export interface PresenceGroup {
	key: string
	position: number
	members: PresenceReader[]
}

export function groupPresence(readers: PresenceReader[], railHeight: number): PresenceGroup[] {
	const threshold = railHeight > 0 ? Math.max(18, railHeight / 10) / railHeight * 100 : 10
	const sorted = [...readers].sort((a, b) => a.position - b.position)
	const groups: PresenceReader[][] = []
	for (const reader of sorted) {
		const last = groups.at(-1)
		if (last && reader.position - last[0]!.position <= threshold)
			last.push(reader)
		else
			groups.push([reader])
	}
	return groups.map(members => ({
		key: members.map(member => member.identity).sort()[0]!,
		position: Math.round(members.reduce((sum, member) => sum + member.position, 0) / members.length),
		members,
	}))
}

/** 组的说明：「名字 · N%」最多列 5 个，其余「及其他 N 人」；没留名字的（映射成的「匿名」）按界面语言写 */
export function presenceLabelOf(group: PresenceGroup, lang: UiLang = 'zh') {
	const shown = group.members.slice(0, 5).map(member => `${member.name === '匿名' ? translate(lang, 'common.anonymous') : member.name} · ${member.position}%`)
	const rest = group.members.length - shown.length
	return rest > 0 ? [...shown, translate(lang, 'post.andOthers', { n: rest })] : shown
}
