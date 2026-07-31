import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignUpForm } from './sign-up-form'

vi.mock('@tanstack/react-router', async importOriginal => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	useRouter: () => ({ navigate: vi.fn() }),
}))

describe('SignUpForm', () => {
	afterEach(cleanup)

	it('shows the email verification completion state', () => {
		render(<SignUpForm verified />)

		expect(screen.getByRole('heading', { name: 'Електронну пошту підтверджено' })).toBeDefined()
		expect(screen.getByRole('button', { name: 'Перейти до входу' })).toBeDefined()
	})

	it('shows an error instead of completion when the verification link failed', () => {
		render(<SignUpForm verified verificationError="TOKEN_EXPIRED" />)

		expect(screen.getByRole('heading', { name: 'Не вдалося підтвердити електронну пошту' })).toBeDefined()
		expect(screen.queryByRole('heading', { name: 'Електронну пошту підтверджено' })).toBeNull()
	})
})
