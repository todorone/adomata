import { logger } from '../core/logger'

type EmailMessage = {
	to: string
	subject: string
	text: string
	html: string
}

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

export function escapeHtml(value: string) {
	return value.replace(/[&<>"']/g, char => {
		switch (char) {
			case '&':
				return '&amp;'
			case '<':
				return '&lt;'
			case '>':
				return '&gt;'
			case '"':
				return '&quot;'
			default:
				return '&#39;'
		}
	})
}

function roleLabel(role: string) {
	switch (role) {
		case 'owner':
			return 'власник'
		case 'admin':
			return 'адміністратор'
		default:
			return 'учасник'
	}
}

export async function sendEmail(message: EmailMessage) {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
	const token = process.env.CLOUDFLARE_EMAIL_API_TOKEN
	const from = process.env.EMAIL_FROM

	if (!accountId || !token || !from) {
		logger.warn('[email] delivery is not configured; skipping send', { to: message.to })
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

export async function sendInvitationEmail(params: {
	email: string
	organizationName: string
	inviterName: string
	role: string
}) {
	const clientUrl = process.env.CLIENT_URL
	if (!clientUrl) throw new Error('[email] CLIENT_URL must be configured to send invitation emails')

	const signupUrl = `${clientUrl.replace(/\/+$/, '')}/sign-up?email=${encodeURIComponent(params.email)}`
	const role = roleLabel(params.role)
	const subject = `Запрошення до агенції ${params.organizationName}`
	const text = [
		`${params.inviterName} запросив(-ла) вас приєднатися до агенції ${params.organizationName} як ${role}.`,
		'',
		`Прийміть запрошення, зареєструвавшись: ${signupUrl}`,
		'',
		'Це запрошення діє 7 днів.',
	].join('\n')
	const html = [
		`<p>${escapeHtml(params.inviterName)} запросив(-ла) вас приєднатися до агенції <strong>${escapeHtml(params.organizationName)}</strong> як ${escapeHtml(role)}.</p>`,
		`<p><a href="${escapeHtml(signupUrl)}">Прийняти запрошення</a></p>`,
		'<p>Це запрошення діє 7 днів.</p>',
	].join('')

	await sendEmail({ to: params.email, subject, text, html })
}
