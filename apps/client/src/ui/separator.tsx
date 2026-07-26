import * as React from 'react'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'

import { cn } from '@/lib/utils'

function Separator({
	className,
	orientation = 'horizontal',
	decorative = true,
	style,
	...props
}: React.ComponentProps<typeof SeparatorPrimitive> & { decorative?: boolean }) {
	const classes = cn(
		'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
		className,
	)

	if (decorative) {
		return (
			<div
				data-slot="separator"
				data-orientation={orientation}
				className={classes}
				style={typeof style === 'function' ? undefined : style}
				{...props}
			/>
		)
	}

	return (
		<SeparatorPrimitive
			data-slot="separator"
			orientation={orientation}
			className={classes}
			style={style}
			{...props}
		/>
	)
}

export { Separator }
