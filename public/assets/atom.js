// 订阅源页面（atom.xsl）里的时间换成读者本地的写法。放在单独的文件里，订阅源的 CSP 只放行同源脚本
document.addEventListener('DOMContentLoaded', () => {
	document.querySelectorAll('time').forEach((time) => {
		const dateTime = new Date(time.dateTime)
		if (!Number.isNaN(dateTime.getTime())) {
			time.textContent = dateTime.toLocaleDateString()
			time.title = dateTime.toLocaleString(undefined, { timeZoneName: 'long' })
		}
	})
})
