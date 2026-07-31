import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchCreativeMedia, mediaRange } from '../fleet-board/media'

describe('Fleet Board creative media', () => {
	afterEach(() => vi.unstubAllGlobals())

	it('forwards a valid byte range and preserves the partial-video response', async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response('video slice', {
				status: 206,
				headers: {
					'content-type': 'video/mp4',
					'content-length': '11',
					'content-range': 'bytes 0-10/100',
					'accept-ranges': 'bytes',
				},
			}),
		)
		vi.stubGlobal('fetch', fetch)

		const media = await fetchCreativeMedia('https://media.example.test/ad.mp4', mediaRange('bytes=0-10'))

		expect(fetch).toHaveBeenCalledWith('https://media.example.test/ad.mp4', { headers: { Range: 'bytes=0-10' } })
		expect(media).toMatchObject({
			status: 206,
			contentType: 'video/mp4',
			contentLength: '11',
			contentRange: 'bytes 0-10/100',
			acceptRanges: 'bytes',
		})
	})

	it('rejects malformed byte ranges', () => {
		expect(mediaRange('bytes=-')).toBeUndefined()
		expect(mediaRange('bytes=0-10,20-30')).toBeUndefined()
	})
})
