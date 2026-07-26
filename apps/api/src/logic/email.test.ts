import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
const originalFetch = globalThis.fetch

function firstRequest() {
	return fetchMock.mock.calls[0] as unknown as [string, RequestInit]
}

function firstRequestBody() {
	return JSON.parse(firstRequest()[1].body as string) as Record<string, string>
}

beforeEach(() => {
	fetchMock.mockReset()
	fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }))
	globalThis.fetch = fetchMock as unknown as typeof fetch
	process.env.CLOUDFLARE_ACCOUNT_ID = 'account_1'
	process.env.CLOUDFLARE_EMAIL_API_TOKEN = 'token_1'
	process.env.EMAIL_FROM = 'Adomata <noreply@adomata.com>'
	process.env.CLIENT_URL = 'https://app.adomata.com'
})

afterEach(() => {
	globalThis.fetch = originalFetch
	delete process.env.CLOUDFLARE_ACCOUNT_ID
	delete process.env.CLOUDFLARE_EMAIL_API_TOKEN
	delete process.env.EMAIL_FROM
	delete process.env.CLIENT_URL
})

describe('sendInvitationEmail', () => {
	it('delivers the Agency owner invitation through Cloudflare Email', async () => {
		const { sendInvitationEmail } = await import('./email')

		await sendInvitationEmail({
			email: 'owner@example.com',
			organizationName: 'Агенція «Вектор»',
			inviterName: 'Адміністратор',
			role: 'owner',
		})

		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = firstRequest()
		expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/account_1/email/sending/send')
		expect(init.method).toBe('POST')
		expect(firstRequestBody()).toMatchObject({
			from: 'Adomata <noreply@adomata.com>',
			to: 'owner@example.com',
		})
		const invitationLink = 'https://app.adomata.com/sign-up?email=owner%40example.com'
		expect(firstRequestBody().text).toContain(invitationLink)
		expect(firstRequestBody().html).toContain(invitationLink)
	})

	it('fails when Cloudflare Email is not configured', async () => {
		delete process.env.CLOUDFLARE_EMAIL_API_TOKEN
		const { sendInvitationEmail } = await import('./email')

		await expect(
			sendInvitationEmail({
				email: 'owner@example.com',
				organizationName: 'Агенція «Вектор»',
				inviterName: 'Адміністратор',
				role: 'owner',
			}),
		).rejects.toThrow('CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_EMAIL_API_TOKEN, and EMAIL_FROM')
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('fails when the client URL is not configured', async () => {
		delete process.env.CLIENT_URL
		const { sendInvitationEmail } = await import('./email')

		await expect(
			sendInvitationEmail({
				email: 'owner@example.com',
				organizationName: 'Агенція «Вектор»',
				inviterName: 'Адміністратор',
				role: 'owner',
			}),
		).rejects.toThrow('CLIENT_URL must be configured')
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
