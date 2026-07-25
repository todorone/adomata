import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { authClient } from '@/lib/auth-client'
import { refreshCachedSession } from '@/data/session'

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
			setError(signInError.message ?? 'Invalid email or password')
			return
		}

		await refreshCachedSession()
		await router.navigate({ to: '/' })
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-6">
			<div className="flex flex-col gap-2 text-center">
				<h1 className="text-2xl font-bold tracking-tight">Sign in to your account</h1>
				<p className="text-muted-foreground text-sm">Enter your email and password below</p>
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
					<Label htmlFor="password">Password</Label>
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
				{loading ? 'Signing in…' : 'Sign in'}
			</Button>
		</form>
	)
}
