type EmailMessage = {
	to: string
	subject: string
	text: string
	html: string
}

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

export async function sendEmail(message: EmailMessage) {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
	const token = process.env.CLOUDFLARE_EMAIL_API_TOKEN
	const from = process.env.EMAIL_FROM

	if (!accountId || !token || !from) {
		console.warn(
			`[email] not configured (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_EMAIL_API_TOKEN/EMAIL_FROM); skipping send to ${message.to}`,
		)
		return
	}

	const response = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}/email/sending/send`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			html: message.html,
		}),
	})

	if (!response.ok) {
		const detail = await response.text().catch(() => '')
		throw new Error(`[email] failed to send to ${message.to}: ${response.status} ${detail}`)
	}
}
