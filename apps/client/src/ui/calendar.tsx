import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { uk } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/ui/button'

function Calendar({ className, classNames, showOutsideDays = true, ...props }: React.ComponentProps<typeof DayPicker>) {
	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			locale={uk}
			weekStartsOn={1}
			className={cn('relative p-3', className)}
			classNames={{
				months: 'flex flex-col sm:flex-row gap-4',
				month: 'flex flex-col gap-3',
				month_caption: 'flex justify-center items-center pt-1 text-sm font-medium capitalize',
				nav: 'flex items-center justify-between absolute inset-x-1 top-1',
				button_previous: cn(buttonVariants({ variant: 'outline', size: 'icon-sm' })),
				button_next: cn(buttonVariants({ variant: 'outline', size: 'icon-sm' })),
				month_grid: 'w-full border-collapse',
				weekdays: 'flex',
				weekday: 'w-9 text-xs font-normal text-muted-foreground capitalize',
				week: 'flex w-full mt-1',
				day: 'p-0 text-center text-sm',
				day_button: cn(buttonVariants({ variant: 'ghost' }), 'size-9 rounded-md p-0 font-normal'),
				range_start: 'rounded-l-md bg-primary [&>button]:bg-primary [&>button]:text-primary-foreground',
				range_end: 'rounded-r-md bg-primary [&>button]:bg-primary [&>button]:text-primary-foreground',
				range_middle: 'bg-accent [&>button]:bg-transparent [&>button]:text-accent-foreground',
				selected: 'rounded-md [&>button]:bg-primary [&>button]:text-primary-foreground',
				today: '[&:not([data-selected])>button]:bg-accent [&:not([data-selected])>button]:text-accent-foreground',
				outside: 'text-muted-foreground opacity-50',
				disabled: 'text-muted-foreground opacity-40',
				hidden: 'invisible',
				...classNames,
			}}
			components={{
				Chevron: ({ orientation }) =>
					orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />,
			}}
			{...props}
		/>
	)
}

export { Calendar }
