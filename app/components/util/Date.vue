<script setup lang="ts">
import { Temporal } from 'temporal-polyfill'

const props = withDefaults(defineProps<{
	icon?: string
	date?: string | Temporal.ZonedDateTime
	format?: dateTimeFormatOptions
	absolute?: boolean
	relative?: boolean
	nospace?: boolean
	tipFormat?: dateTimeFormatOptions
	tipTransform?: (formattedDate: string) => string
}>(), {
	tipTransform: String,
})

// 日期与相对时间按界面语言（前缀版是英文）
const locale = useUiLocale()
const timeZone = useSiteTimeZone()
// 「今天」与显示都按站点时区，服务端渲染与浏览器一致
const today = computed(() => Temporal.Now.plainDateISO(timeZone.value))
const zdt = computed(() => {
	try {
		return typeof props.date === 'string' ? toZonedTemporal(props.date, timeZone.value) : props.date?.withTimeZone(timeZone.value)
	}
	catch {
		return null
	}
})

const relative = computed(() => props.absolute || !zdt.value
	? false
	: props.relative || today.value.since(zdt.value, { largestUnit: 'week' }).weeks < 1,
)

const mounted = useMounted()
const tooltip = computed(() => mounted.value && zdt.value
	? props.tipTransform(toZdtLocaleString(zdt.value, props.tipFormat, locale.value))
	: props.date as string,
)
</script>

<template>
<span :title="tooltip">
	<Icon v-if="icon" :name="icon" />
	<template v-if="icon && !nospace">&nbsp;</template>

	<span v-if="!zdt">Invalid Date</span>

	<time
		v-else-if="format"
		:datetime="toInstantString(zdt)"
		v-text="toZdtLocaleString(zdt, format, locale)"
	/>

	<NuxtTime
		v-else
		:datetime="toInstantString(zdt)"
		:relative
		:locale
		:time-zone="timeZone"
		:year="zdt.year === today.year ? undefined : '2-digit'"
		month="long"
		day="numeric"
		numeric="auto"
	/>
</span>
</template>
