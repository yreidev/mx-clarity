/** 读者发出评论后多久内能改（与官方主题一致；core 本身不限时）。浏览器与服务端共用 */
export const COMMENT_EDIT_WINDOW = 10 * 60_000

/** 评论还在可编辑时间内 */
export function isEditableAt(createdAt: unknown, now: number) {
	const time = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN
	return Number.isFinite(time) && now - time < COMMENT_EDIT_WINDOW
}
