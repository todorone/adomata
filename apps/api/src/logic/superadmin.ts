export function isSuperadmin(email: string) {
	return Boolean(process.env.SUPERADMIN_EMAIL && email.toLowerCase() === process.env.SUPERADMIN_EMAIL.toLowerCase())
}
