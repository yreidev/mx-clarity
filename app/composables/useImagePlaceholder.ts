import type { MaybeElementRef } from '@vueuse/core'
import { thumbHashToDataURL } from 'thumbhash'

const ACCENT = /^#(?:[\da-f]{3}|[\da-f]{6})$/i
const THUMBHASH = /^[A-Z0-9+/]{16,120}={0,2}$/i

/** base64 的 thumbhash → 模糊占位图的 data URL；格式不对、解码失败都返回 undefined */
export function thumbhashDataUrl(hash: string | undefined) {
	if (!hash || !THUMBHASH.test(hash))
		return undefined
	try {
		return thumbHashToDataURL(Uint8Array.from(atob(hash), char => char.charCodeAt(0)))
	}
	catch {
		return undefined
	}
}

/**
 * 图片加载前的占位：主色当底色（服务端渲染就有），挂载后把 thumbhash 解成模糊图垫在图片底下，
 * 图片加载完就把两样都去掉（透明图片不会透出底色）。值在服务端校验过，这里再挡一次
 */
export function useImagePlaceholder(options: MaybeRefOrGetter<{ accent?: string, thumbhash?: string }>, target: MaybeElementRef) {
	const loaded = ref(false)
	const blur = ref<string>()

	onMounted(() => {
		const el = unrefElement(target)
		if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) {
			loaded.value = true
			return
		}
		blur.value = thumbhashDataUrl(toValue(options).thumbhash)
	})

	const style = computed(() => {
		if (loaded.value)
			return undefined
		const { accent } = toValue(options)
		return {
			backgroundColor: accent && ACCENT.test(accent) ? accent : undefined,
			backgroundImage: blur.value ? `url("${blur.value}")` : undefined,
			backgroundSize: blur.value ? 'cover' : undefined,
		}
	})

	function onLoad() {
		loaded.value = true
	}

	return { style, onLoad }
}
