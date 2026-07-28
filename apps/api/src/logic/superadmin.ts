export function isSuperadminRole(role: string) {
	return role === 'super'
}

export function isBootstrapSuperadminEmail(email: string) {
	return Boolean(process.env.SUPERADMIN_EMAIL && email.toLowerCase() === process.env.SUPERADMIN_EMAIL.toLowerCase())
}
