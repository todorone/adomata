import { describe, expect, it } from 'vitest'

import { normalizeCreative } from './creative'

describe('Fleet Board creative normalization', () => {
	it('keeps every asset-feed variant and existing-post fallback visible', () => {
		const creative = normalizeCreative({
			id: 'creative-1',
			adId: 'ad-1',
			name: 'Dynamic creative',
			payload: {
				asset_feed_spec: {
					images: [{ hash: 'image-1' }],
					videos: [{ video_id: 'video-1' }],
					bodies: [{ text: 'Основний текст' }],
					titles: [{ text: 'Заголовок' }],
					descriptions: [{ text: 'Опис' }],
					link_urls: [{ website_url: 'https://example.test/landing' }],
					call_to_actions: [{ type: 'LEARN_MORE' }],
					asset_customization_rules: [
						{
							customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['feed'] },
							image_label: 'image-1',
						},
					],
				},
				effective_object_story_id: 'page_1_2',
			},
		} as never)

		expect(creative.assets).toHaveLength(8)
		expect(creative.assets.map(asset => asset.kind)).toEqual([
			'image',
			'video',
			'text',
			'text',
			'text',
			'link',
			'cta',
			'placement',
		])
		expect(creative).toMatchObject({
			kind: 'asset_feed',
			existingPostId: 'page_1_2',
			mediaUnavailable: true,
		})
	})

	it('uses a streamable video in preference to its thumbnail', () => {
		const creative = normalizeCreative({
			id: 'creative-1',
			adId: 'ad-1',
			name: 'Video creative',
			payload: {
				video_id: 'video-1',
				video_url: 'https://media.example.test/video-1.mp4',
				thumbnail_url: 'https://media.example.test/video-1.jpg',
			},
		})

		expect(creative.assets).toEqual([{ key: 'm0', kind: 'video', label: 'Відео', value: null, mediaKey: 'm0' }])
		expect(creative.mediaUnavailable).toBe(false)
	})

	it('keeps streamable asset-feed videos playable', () => {
		const creative = normalizeCreative({
			id: 'creative-1',
			adId: 'ad-1',
			name: 'Dynamic video creative',
			payload: {
				asset_feed_spec: {
					videos: [{ video_id: 'video-1', video_url: 'https://media.example.test/video-1.mp4' }],
				},
			},
		})

		expect(creative.assets[0]).toMatchObject({ kind: 'video', label: 'Відео 1', mediaKey: 'm0' })
	})
})
