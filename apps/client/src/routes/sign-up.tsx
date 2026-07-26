import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { GalleryVerticalEnd } from 'lucide-react'

import { SignUpForm } from '@/components/sign-up-form'
import { redirectAuthenticatedUser } from '@/data/session'

const searchSchema = z.object({
	email: z.string().optional(),
})

export const Route = createFileRoute('/sign-up')({
	validateSearch: searchSchema,
	beforeLoad: () => redirectAuthenticatedUser(),
	component: SignUpPage,
})

function SignUpPage() {
	const { email } = Route.useSearch()

	return (
		<div className="flex min-h-svh items-center justify-center">
			<div className="flex flex-col gap-4 p-6 md:p-10">
				<div className="flex justify-center gap-2">
					<a href="/" className="flex items-center gap-2 font-medium">
						<div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
							<GalleryVerticalEnd className="size-4" />
						</div>
						Adomata
					</a>
				</div>
				<div className="flex flex-1 items-center justify-center">
					<div className="w-full max-w-xs">
						<SignUpForm initialEmail={email} />
					</div>
				</div>
			</div>
		</div>
	)
}
