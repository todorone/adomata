import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { authClient } from '@/lib/auth-client'
import { refreshCachedSession } from '@/data/session'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'

type SignUpFormProps = {
	initialEmail?: string
}

export function SignUpForm({ initialEmail = '' }: SignUpFormProps) {
	const router = useRouter()
	const [name, setName] = useState('')
	const [email, setEmail] = useState(initialEmail)
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [checkEmail, setCheckEmail] = useState(false)

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()
		setError(null)
		setLoading(true)

		const { data, error: signUpError } = await authClient.signUp.email({ name, email, password })

		setLoading(false)

		if (signUpError) {
			setError(signUpError.message ?? 'Для реєстрації потрібне дійсне запрошення.')
			return
		}

		if (!data?.token) {
			setCheckEmail(true)
			return
		}

		await refreshCachedSession()
		await router.navigate({ to: '/' })
	}

	if (checkEmail) {
		return (
			<div className="flex flex-col gap-4 text-center">
				<h1 className="text-2xl font-bold tracking-tight">Перевірте електронну пошту</h1>
				<p className="text-muted-foreground text-sm">
					Ми надіслали посилання для підтвердження на {email}. Підтвердьте адресу, а потім увійдіть.
				</p>
				<Button className="w-full" onClick={() => router.navigate({ to: '/login' })}>
					Перейти до входу
				</Button>
			</div>
		)
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-6">
			<div className="flex flex-col gap-2 text-center">
				<h1 className="text-2xl font-bold tracking-tight">Створіть обліковий запис</h1>
				<p className="text-muted-foreground text-sm">Завершіть реєстрацію, щоб приєднатися до агенції</p>
			</div>

			{error && <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{error}</p>}

			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="name">Ім’я</Label>
					<Input
						id="name"
						type="text"
						autoComplete="name"
						required
						value={name}
						onChange={event => setName(event.target.value)}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="email">Електронна пошта</Label>
					<Input
						id="email"
						type="email"
						autoComplete="email"
						required
						value={email}
						onChange={event => setEmail(event.target.value)}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="password">Пароль</Label>
					<Input
						id="password"
						type="password"
						autoComplete="new-password"
						required
						value={password}
						onChange={event => setPassword(event.target.value)}
					/>
				</div>
			</div>

			<Button type="submit" className="w-full" disabled={loading}>
				{loading ? 'Створюємо обліковий запис…' : 'Зареєструватися'}
			</Button>
		</form>
	)
}
