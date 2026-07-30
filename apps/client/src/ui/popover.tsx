import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'

import { cn } from '@/lib/utils'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
	asChild,
	children,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger> & { asChild?: boolean }) {
	return (
		<PopoverPrimitive.Trigger
			data-slot="popover-trigger"
			render={asChild ? (children as React.ReactElement) : undefined}
			{...props}
		/>
	)
}

function PopoverContent({
	className,
	sideOffset = 4,
	side,
	align = 'start',
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> &
	Pick<React.ComponentProps<typeof PopoverPrimitive.Positioner>, 'side' | 'align'> & { sideOffset?: number }) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50">
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						'z-50 max-h-(--available-height) w-72 origin-(--transform-origin) overflow-y-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95',
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	)
}

export { Popover, PopoverTrigger, PopoverContent }
