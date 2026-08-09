import { describe, expect, it } from 'vitest'

import { creativeHasVideo, mediaUrlForKey, needsCreativeMediaRefresh, normalizeCreative } from './creative'

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

		expect(creative.assets).toEqual([{ key: 'm0', kind: 'video', label: 'Відео 1', value: null, mediaKey: 'm0' }])
	})

	it('keeps a video Meta refused to serve visible as an asset with no media', () => {
		const creative = normalizeCreative({
			id: 'creative-1',
			adId: 'ad-1',
			name: 'Video creative',
			payload: { video_id: 'video-1', thumbnail_url: 'https://media.example.test/video-1.jpg' },
		})

		expect(creative.assets).toEqual([
			{ key: 'video', kind: 'video', label: 'Відео', value: 'video-1', mediaKey: null },
		])
		expect(creative.mediaUnavailable).toBe(true)
	})

	it('flags a Creative as video from a direct video, a resolved video URL, or an asset-feed video', () => {
		expect(creativeHasVideo({ video_id: 'video-1' })).toBe(true)
		expect(creativeHasVideo({ video_url: 'https://media.example.test/video-1.mp4' })).toBe(true)
		expect(creativeHasVideo({ asset_feed_spec: { videos: [{ video_id: 'video-1' }] } })).toBe(true)
		expect(creativeHasVideo({ image_url: 'https://media.example.test/image-1.jpg' })).toBe(false)
		expect(creativeHasVideo({ asset_feed_spec: { videos: [] } })).toBe(false)
		expect(creativeHasVideo(null)).toBe(false)
	})

	it('uses resolved asset-feed image URLs and excludes the ad thumbnail from expanded media', () => {
		const payload = {
			thumbnail_url: 'https://media.example.test/thumbnail-64.jpg',
			asset_feed_spec: {
				images: [
					{ hash: 'image-1', url: 'https://media.example.test/image-1.jpg' },
					{ hash: 'image-2', url: 'https://media.example.test/image-2.jpg' },
				],
			},
		}
		const creative = normalizeCreative({
			id: 'creative-1',
			adId: 'ad-1',
			name: 'Resolved asset feed',
			payload,
		})

		expect(creative.assets.filter(asset => asset.mediaKey)).toEqual([
			{ key: 'a-images-0', kind: 'image', label: 'Зображення 1', value: 'image-1', mediaKey: 'a-images-0' },
			{ key: 'a-images-1', kind: 'image', label: 'Зображення 2', value: 'image-2', mediaKey: 'a-images-1' },
		])
		expect(creative.assets.some(asset => asset.label === 'Ескіз відео')).toBe(false)
		expect(mediaUrlForKey({ payload }, 'a-images-1')).toBe('https://media.example.test/image-2.jpg')
	})

	it('marks hash-only asset-feed images for refresh', () => {
		expect(needsCreativeMediaRefresh({ payload: { asset_feed_spec: { images: [{ hash: 'image-1' }] } } })).toBe(true)
		expect(
			needsCreativeMediaRefresh({
				payload: {
					asset_feed_spec: { images: [{ hash: 'image-1', url: 'https://media.example.test/image-1.jpg' }] },
				},
			}),
		).toBe(false)
	})
})
