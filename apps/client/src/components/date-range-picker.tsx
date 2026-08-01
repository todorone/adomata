import * as React from 'react'
import { CalendarIcon, ChevronRight } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import type { FleetBoardRange, FleetBoardRangePreset } from '@adomata/api/client'

import { Button } from '@/ui/button'
import { Calendar } from '@/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

type RangePreset = Exclude<FleetBoardRangePreset, 'custom'>

const presets: Array<{ key: RangePreset; label: string }> = [
	{ key: 'today', label: 'Сьогодні' },
	{ key: 'yesterday', label: 'Вчора' },
	{ key: 'last7', label: 'Останні 7 днів' },
	{ key: 'last14', label: 'Останні 14 днів' },
	{ key: 'last30', label: 'Останні 30 днів' },
	{ key: 'thisWeek', label: 'Цей тиждень' },
	{ key: 'lastWeek', label: 'Минулий тиждень' },
	{ key: 'thisMonth', label: 'Цей місяць' },
	{ key: 'lastMonth', label: 'Минулий місяць' },
]
export const rangePresetLabels = Object.fromEntries(presets.map(preset => [preset.key, preset.label])) as Record<
	RangePreset,
	string
>

const dateFormatter = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })

function isoDate(date: Date) {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function parseIsoDate(date: string) {
	const [year, month, day] = date.split('-').map(Number)
	return new Date(year!, month! - 1, day!)
}
function draftFor(value: FleetBoardRange): DateRange | undefined {
	return typeof value === 'string' ? undefined : { from: parseIsoDate(value.start), to: parseIsoDate(value.end) }
}

export function DateRangePicker({
	value,
	onChange,
}: {
	value: FleetBoardRange
	onChange: (range: FleetBoardRange) => void
}) {
	const [isOpen, setIsOpen] = React.useState(false)
	const [draft, setDraft] = React.useState<DateRange | undefined>(() => draftFor(value))
	// react-day-picker's range mode reports the very first click as an already-complete
	// same-day range (its `to` defaults to `from`). Only the second click is the buyer
	// actually finishing a range, so that's the one that applies and closes the popover.
	const pickedOnce = React.useRef(false)

	function selectRange(range: DateRange | undefined) {
		setDraft(range)
		if (pickedOnce.current && range?.from && range.to) {
			onChange({ start: isoDate(range.from), end: isoDate(range.to) })
			setIsOpen(false)
		}
		pickedOnce.current = true
	}

	return (
		<Popover
			open={isOpen}
			onOpenChange={open => {
				setIsOpen(open)
				if (open) {
					setDraft(draftFor(value))
					pickedOnce.current = false
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button type="button" size="sm" variant="outline">
					<CalendarIcon />
					{typeof value === 'string' ? (
						rangePresetLabels[value]
					) : (
						<span className="flex items-center gap-1">
							{dateFormatter.format(parseIsoDate(value.start))}
							<ChevronRight size={12} />
							{dateFormatter.format(parseIsoDate(value.end))}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="flex w-auto flex-col gap-3 sm:flex-row">
				<div className="flex shrink-0 flex-col gap-1 sm:border-r sm:pr-3">
					{presets.map(preset => (
						<Button
							key={preset.key}
							type="button"
							size="sm"
							variant={value === preset.key ? 'secondary' : 'ghost'}
							className="justify-start"
							onClick={() => {
								onChange(preset.key)
								setIsOpen(false)
							}}
						>
							{preset.label}
						</Button>
					))}
				</div>
				<Calendar
					mode="range"
					selected={draft}
					onSelect={selectRange}
					numberOfMonths={2}
					disabled={{ after: new Date() }}
				/>
			</PopoverContent>
		</Popover>
	)
}
