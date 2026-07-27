import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModalProvider } from '@/components/modal-provider'
import { WipeDatabase } from '@/routes/super.database'

const { wipe, navigate } = vi.hoisted(() => ({ wipe: vi.fn(), navigate: vi.fn() }))

vi.mock('@/data/database', () => ({
	useWipeDatabase: () => ({ mutate: wipe, isPending: false, isError: false }),
}))

vi.mock('@tanstack/react-router', async importOriginal => ({
	...(await importOriginal<typeof import('@tanstack/react-router')>()),
	useNavigate: () => navigate,
}))

function renderWipeDatabase() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<ModalProvider>
				<WipeDatabase />
			</ModalProvider>
		</QueryClientProvider>,
	)
}

describe('WipeDatabase', () => {
	beforeEach(() => {
		wipe.mockReset()
		navigate.mockReset()
	})

	afterEach(cleanup)

	it('wipes the database after confirmation', async () => {
		renderWipeDatabase()

		fireEvent.click(screen.getByRole('button', { name: 'Очистити базу даних' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Очистити все' }))

		await waitFor(() => expect(wipe).toHaveBeenCalled())
	})

	it('does not wipe when the confirmation is cancelled', async () => {
		renderWipeDatabase()

		fireEvent.click(screen.getByRole('button', { name: 'Очистити базу даних' }))
		fireEvent.click(await screen.findByRole('button', { name: 'Скасувати' }))

		await waitFor(() => expect(screen.queryByRole('button', { name: 'Скасувати' })).toBeNull())
		expect(wipe).not.toHaveBeenCalled()
	})
})
