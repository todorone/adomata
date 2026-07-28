export function isSuperadminRole(role: string) {
	return role === 'super'
}

// Bootstraps the very first superadmin before any `user` row (and therefore any role) exists.
// Ongoing authorization must use isSuperadminRole against the DB-backed role instead.
export function isBootstrapSuperadminEmail(email: string) {
	return Boolean(process.env.SUPERADMIN_EMAIL && email.toLowerCase() === process.env.SUPERADMIN_EMAIL.toLowerCase())
}
