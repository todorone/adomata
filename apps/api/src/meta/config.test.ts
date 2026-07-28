import { describe, expect, it } from 'vitest'

import { parseMetaConfig, requireHeartbeatSecret } from './config'

describe('parseMetaConfig', () => {
	it('defaults to live mode when META_API_MODE is unset or not "fake"', () => {
		expect(parseMetaConfig({})).toEqual({ mode: 'live', accessToken: 'fake-meta-access-token' })
		expect(parseMetaConfig({ META_API_MODE: 'preview' })).toEqual({
			mode: 'live',
			accessToken: 'fake-meta-access-token',
		})
	})

	it('does not require META_ACCESS_TOKEN in live mode (tokens are per-Agency)', () => {
		expect(parseMetaConfig({ META_API_MODE: 'live' })).toEqual({
			mode: 'live',
			accessToken: 'fake-meta-access-token',
		})
		expect(parseMetaConfig({ META_API_MODE: 'live', META_ACCESS_TOKEN: '  ' })).toEqual({
			mode: 'live',
			accessToken: 'fake-meta-access-token',
		})
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

	it('requires a non-blank heartbeat secret in every mode', () => {
		expect(() => requireHeartbeatSecret({})).toThrow('HEARTBEAT_SECRET must be set')
		expect(() => requireHeartbeatSecret({ HEARTBEAT_SECRET: '  ' })).toThrow('HEARTBEAT_SECRET must be set')
		expect(requireHeartbeatSecret({ HEARTBEAT_SECRET: ' secret ' })).toBe('secret')
	})
})
