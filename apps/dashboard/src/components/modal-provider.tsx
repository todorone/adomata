import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

import { Button } from '@/ui/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/ui/dialog'

type ModalControls<TResult> = {
	close: (result: TResult) => void
	dismiss: () => void
}

type ModalOptions<TResult> = {
	render: (controls: ModalControls<TResult>) => ReactNode
}

type ModalContextValue = {
	showModal: <TResult = void>(options: ModalOptions<TResult>) => Promise<TResult | undefined>
}

type ActiveModal<TResult = unknown> = {
	render: (controls: ModalControls<TResult>) => ReactNode
	resolve: (result: TResult | undefined) => void
}

const ModalContext = createContext<ModalContextValue | null>(null)

export function ModalProvider({ children }: { children: ReactNode }) {
	const [activeModal, setActiveModal] = useState<ActiveModal | null>(null)

	const value = useMemo<ModalContextValue>(
		() => ({
			showModal: options =>
				new Promise(resolve => {
					setActiveModal({
						render: options.render as ActiveModal['render'],
						resolve: resolve as ActiveModal['resolve'],
					})
				}),
		}),
		[],
	)

	function resolveActiveModal(result: unknown) {
		activeModal?.resolve(result)
		setActiveModal(null)
	}

	return (
		<ModalContext.Provider value={value}>
			{children}
			<Dialog open={Boolean(activeModal)} onOpenChange={open => !open && resolveActiveModal(undefined)}>
				{activeModal?.render({
					close: result => resolveActiveModal(result),
					dismiss: () => resolveActiveModal(undefined),
				})}
			</Dialog>
		</ModalContext.Provider>
	)
}

export function useModal() {
	const context = useContext(ModalContext)

	if (!context) {
		throw new Error('useModal must be used within ModalProvider')
	}

	return context
}

type ConfirmOptions = {
	title: string
	description: string
	confirmLabel?: string
	cancelLabel?: string
	variant?: 'default' | 'destructive'
}

export function useConfirm() {
	const { showModal } = useModal()

	return (options: ConfirmOptions) =>
		showModal<boolean>({
			render: ({ close, dismiss }) => (
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{options.title}</DialogTitle>
						<DialogDescription>{options.description}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline" onClick={dismiss}>
								{options.cancelLabel ?? 'Cancel'}
							</Button>
						</DialogClose>
						<Button variant={options.variant ?? 'destructive'} onClick={() => close(true)}>
							{options.confirmLabel ?? 'Delete'}
						</Button>
					</DialogFooter>
				</DialogContent>
			),
		}).then(Boolean)
}
