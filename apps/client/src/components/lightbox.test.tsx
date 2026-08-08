import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { Lightbox, type LightboxAsset } from '@/components/lightbox'

const assets: LightboxAsset[] = [
	{ key: 'image-1', kind: 'image', label: 'Перший варіант', mediaKey: 'image-1' },
	{ key: 'video-1', kind: 'video', label: 'Відеоверсія', mediaKey: 'video-1' },
	{ key: 'image-2', kind: 'image', label: 'Третій варіант', mediaKey: 'image-2' },
]

function TestLightbox() {
	const [open, setOpen] = useState(true)
	const [selectedAssetKey, setSelectedAssetKey] = useState('video-1')
	return (
		<Lightbox
			open={open}
			onOpenChange={setOpen}
			assets={assets}
			selectedAssetKey={selectedAssetKey}
			onSelectedAssetChange={setSelectedAssetKey}
			mediaUnavailable={false}
			mediaUrl={key => `/media/${key}`}
			metadata={{
				title: 'Тестовий креатив',
				body: 'Основний текст',
				description: 'Опис',
				callToAction: 'Дізнатися більше',
				destination: 'https://example.com',
			}}
			hasMultipleAssets
		>
			<p>Додаткові дані</p>
		</Lightbox>
	)
}

describe('Lightbox', () => {
	afterEach(cleanup)

	it('opens directly at the selected variant with all data, navigates, closes, and shows an unavailable-media fallback', async () => {
		render(<TestLightbox />)

		const dialog = screen.getByRole('dialog')
		expect(within(dialog).getByRole('heading', { name: 'Тестовий креатив' })).toBeTruthy()
		expect(within(dialog).getByLabelText('Відеоверсія')).toBeInstanceOf(HTMLVideoElement)
		expect(within(dialog).getByText('Варіант 2 з 3: Відеоверсія')).toBeTruthy()
		expect(within(dialog).getByText('Основний текст')).toBeTruthy()
		expect(within(dialog).getByText('Опис')).toBeTruthy()
		expect(within(dialog).getByText('Дія: Дізнатися більше')).toBeTruthy()
		expect(within(dialog).getByText('Результати належать оголошенню цілком')).toBeTruthy()
		expect(within(dialog).getByText('Додаткові дані')).toBeTruthy()

		fireEvent.click(within(dialog).getByRole('button', { name: 'Попередній варіант креативу' }))
		expect(within(dialog).getByRole('img', { name: 'Перший варіант' })).toBeTruthy()

		const mediaRegion = within(dialog).getByRole('region', { name: 'Перегляд медіафайлу' })
		const swipeArea = mediaRegion.firstElementChild!
		fireEvent.touchStart(swipeArea, { touches: [{ clientX: 200 }] })
		fireEvent.touchEnd(swipeArea, { changedTouches: [{ clientX: 100 }] })
		expect(within(dialog).getByLabelText('Відеоверсія')).toBeInstanceOf(HTMLVideoElement)

		fireEvent.click(within(dialog).getByRole('button', { name: 'Наступний варіант креативу' }))
		const image = within(dialog).getByRole('img', { name: 'Третій варіант' })
		fireEvent.error(image)
		expect(within(dialog).getByText('Медіафайл «Третій варіант» тимчасово недоступний.')).toBeTruthy()

		fireEvent.click(within(dialog).getByRole('button', { name: 'Закрити' }))
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
	})

	it('shows only the aside when there is no media', () => {
		function NoMediaLightbox() {
			return (
				<Lightbox
					open
					onOpenChange={() => undefined}
					assets={[]}
					selectedAssetKey={null}
					onSelectedAssetChange={() => undefined}
					mediaUnavailable={false}
					mediaUrl={key => `/media/${key}`}
					metadata={{
						title: 'Текстовий креатив',
						body: null,
						description: null,
						callToAction: null,
						destination: null,
					}}
					hasMultipleAssets={false}
				/>
			)
		}
		render(<NoMediaLightbox />)

		const dialog = screen.getByRole('dialog')
		expect(within(dialog).getByRole('heading', { name: 'Текстовий креатив' })).toBeTruthy()
		expect(within(dialog).queryByRole('region', { name: 'Перегляд медіафайлу' })).toBeNull()
	})
})
