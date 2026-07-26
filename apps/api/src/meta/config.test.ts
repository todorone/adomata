import { describe, expect, it } from 'vitest'

import { parseMetaConfig } from './config'

describe('parseMetaConfig', () => {
	it('requires a declared fake or live mode', () => {
		expect(() => parseMetaConfig({})).toThrow('META_API_MODE must be either "fake" or "live"')
		expect(() => parseMetaConfig({ META_API_MODE: 'preview' })).toThrow(
			'META_API_MODE must be either "fake" or "live"',
		)
	})

	it('requires a non-blank access token in live mode', () => {
		expect(() => parseMetaConfig({ META_API_MODE: 'live' })).toThrow('META_ACCESS_TOKEN must be set in live mode')
		expect(() => parseMetaConfig({ META_API_MODE: 'live', META_ACCESS_TOKEN: '  ' })).toThrow(
			'META_ACCESS_TOKEN must be set in live mode',
		)
	})

	it('uses an explicit local token only for fake-mode requests', () => {
		expect(parseMetaConfig({ META_API_MODE: 'fake' })).toEqual({
			mode: 'fake',
			accessToken: 'fake-meta-access-token',
		})
		expect(parseMetaConfig({ META_API_MODE: 'live', META_ACCESS_TOKEN: ' live-token ' })).toEqual({
			mode: 'live',
			accessToken: 'live-token',
		})
	})
})
