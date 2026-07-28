import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { authClient } from '@/lib/auth-client'
import { refreshCachedSession } from '@/data/session'

function signInErrorMessage(message?: string) {
	if (message?.toLowerCase().includes('invalid email or password')) {
		return 'Неправильний email або пароль'
	}
	if (message?.toLowerCase().includes('verif')) {
		return 'Перевірте електронну пошту, щоб підтвердити обліковий запис'
	}
	return message ?? 'Неправильний email або пароль'
}

export function LoginForm() {
	const router = useRouter()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)
		setLoading(true)

		const { error: signInError } = await authClient.signIn.email({
			email,
			password,
		})

		setLoading(false)

		if (signInError) {
			setError(signInErrorMessage(signInError.message))
			return
		}

		await refreshCachedSession()
		await router.navigate({ to: '/' })
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-6">
			<div className="flex flex-col gap-2 text-center">
				<h1 className="text-2xl font-bold tracking-tight">Увійдіть у свій акаунт</h1>
				<p className="text-muted-foreground text-sm">Введіть свій email та пароль нижче</p>
			</div>

			{error && <p className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">{error}</p>}

			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						type="email"
						placeholder="you@example.com"
						autoComplete="email"
						required
						value={email}
						onChange={e => setEmail(e.target.value)}
					/>
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor="password">Пароль</Label>
					<Input
						id="password"
						type="password"
						autoComplete="current-password"
						required
						value={password}
						onChange={e => setPassword(e.target.value)}
					/>
				</div>
			</div>

			<Button type="submit" className="w-full" disabled={loading}>
				{loading ? 'Виконується вхід…' : 'Увійти'}
			</Button>
		</form>
	)
}
