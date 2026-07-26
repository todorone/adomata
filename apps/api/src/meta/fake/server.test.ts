import { describe, expect, it } from 'vitest'

import { rejectUnhandledMetaRequest } from './server'

describe('rejectUnhandledMetaRequest', () => {
	it('blocks every unhandled Meta host while leaving unrelated requests alone', () => {
		expect(() => rejectUnhandledMetaRequest(new Request('https://graph-video.facebook.com/v25.0/request'))).toThrow(
			'Blocked unhandled Meta request in fake mode',
		)
		expect(() => rejectUnhandledMetaRequest(new Request('https://example.com/request'))).not.toThrow()
	})
})
