import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'

function Collapsible({
	asChild,
	children,
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root> & { asChild?: boolean }) {
	return (
		<CollapsiblePrimitive.Root
			data-slot="collapsible"
			render={asChild ? (children as React.ReactElement) : undefined}
			{...props}
		/>
	)
}

function CollapsibleTrigger({
	asChild,
	children,
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & { asChild?: boolean }) {
	return (
		<CollapsiblePrimitive.Trigger
			data-slot="collapsible-trigger"
			render={asChild ? (children as React.ReactElement) : undefined}
			{...props}
		/>
	)
}

function CollapsibleContent({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Panel>) {
	return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
