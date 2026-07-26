import { HttpResponse, http } from 'msw'

import { accountTierFields } from '../client'
import { fakeMetaAccounts } from './roster'

const graphPath = 'https://graph.facebook.com/v25.0/:accountId'

export const fakeMetaHandlers = [
	http.get(graphPath, ({ params, request }) => {
		const url = new URL(request.url)
		if (url.searchParams.get('fields') !== accountTierFields.join(',')) {
			return graphContractError('Unsupported Graph fields requested')
		}
		if (!url.searchParams.get('access_token')) return graphContractError('Missing access token')

		const id = String(params.accountId).replace(/^act_/, '')
		const account = fakeMetaAccounts.find(candidate => candidate.id === id)
		if (!account) return graphContractError(`Unknown fake Meta account: ${id}`)
		if (account.kind === 'throttle') {
			return HttpResponse.json(
				{
					error: {
						message: 'Application request limit reached',
						type: 'OAuthException',
						code: 4,
						fbtrace_id: 'fake-throttle',
					},
				},
				{ status: 400, headers: { 'X-App-Usage': '{"call_count":100,"total_cputime":100,"total_time":100}' } },
			)
		}
		if (account.kind === 'revoked') {
			return HttpResponse.json(
				{
					error: {
						message: 'Permission denied for this ad account',
						type: 'OAuthException',
						code: 10,
						fbtrace_id: 'fake-revoked',
					},
				},
				{ status: 400 },
			)
		}
		if (account.kind !== 'success') return graphContractError(`Unsupported fixture kind: ${account.kind}`)

		return HttpResponse.json({
			id: account.id,
			name: account.name,
			currency: account.currency,
			account_status: account.accountStatus,
			disable_reason: account.disableReason,
			balance: account.balance,
			is_prepay_account: account.isPrepayAccount,
			...(account.fundingSourceType === null ? {} : { funding_source_details: { type: account.fundingSourceType } }),
		})
	}),
	http.all('https://graph.facebook.com/*', ({ request }) =>
		graphContractError(`Unsupported fake Meta request: ${request.url}`),
	),
]

function graphContractError(message: string) {
	return HttpResponse.json({ error: { message, type: 'FakeMetaContractError', code: 1 } }, { status: 500 })
}
