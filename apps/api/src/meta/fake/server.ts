import { setupServer } from 'msw/node'

import { fakeMetaHandlers } from './handlers'

export const fakeMetaServer = setupServer(...fakeMetaHandlers)

export function rejectUnhandledMetaRequest(request: Request) {
	const hostname = new URL(request.url).hostname
	if (
		hostname === 'facebook.com' ||
		hostname.endsWith('.facebook.com') ||
		hostname === 'meta.com' ||
		hostname.endsWith('.meta.com')
	) {
		throw new Error(`Blocked unhandled Meta request in fake mode: ${request.url}`)
	}
}
