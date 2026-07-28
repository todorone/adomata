const ADOMATA_EMAIL_DOMAIN = '@adomata.com'

export function isAdomataEmail(email: string) {
	return email.trim().toLowerCase().endsWith(ADOMATA_EMAIL_DOMAIN)
}
