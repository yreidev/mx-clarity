/** 项目。不做详情页，卡片直接链到项目地址 */

export interface ProjectProps {
	id: string
	name: string
	description: string
	/** 已过协议白名单 */
	avatar?: string
	links: {
		project?: string
		preview?: string
		doc?: string
	}
}
