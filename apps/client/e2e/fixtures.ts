// Shared constants + thin HTTP helpers for E2E specs. Everything is seeded
// through the real API (no DB driver, no test-only endpoints).

export const APP_URL = process.env['CLIENT_URL'] ?? 'http://localhost:4173'
export const API_URL = process.env['VITE_API_URL'] ?? 'http://localhost:4000'

// Must match the API's SUPERADMIN_EMAIL — that's the only email `/auth/sign-up/email`
// accepts without a pending invitation (see apps/api/src/logic/auth.ts canSignUpWithEmail).
export const SUPERADMIN = {
	name: 'Super E2E',
	email: process.env['E2E_SUPERADMIN_EMAIL'] ?? 'super@adomata.com',
	password: process.env['E2E_SUPERADMIN_PASSWORD'] ?? process.env['SUPERADMIN_PASSWORD'] ?? 'smartdrv0',
}

type Credentials = { name: string; email: string; password: string }

// The API rejects auth requests without an Origin (better-auth trusted-origin
// check); a browser sends it automatically, so this helper must too.
async function postAuth(path: string, body: unknown) {
	return fetch(`${API_URL}/auth/${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: APP_URL },
		body: JSON.stringify(body),
	})
}

// Try sign-in; on failure (account absent) sign up. Returns the bearer token
// from the `set-auth-token` response header (the better-auth bearer plugin).
export async function signInOrSignUp({ name, email, password }: Credentials) {
	const signIn = await postAuth('sign-in/email', { email, password })
	const token = signIn.ok ? signIn.headers.get('set-auth-token') : null
	if (token) return token

	const signUp = await postAuth('sign-up/email', { name, email, password })
	if (!signUp.ok) {
		throw new Error(`sign-up failed for ${email}: ${signUp.status} ${await signUp.text()}`)
	}
	const signUpToken = signUp.headers.get('set-auth-token')
	if (signUpToken) return signUpToken

	// better-auth withholds a session on sign-up whenever emailVerification.sendOnSignUp
	// is on, even for accounts the API immediately marks emailVerified (SUPERADMIN_EMAIL,
	// @adomata.com) — same "check your email" UX the sign-up form shows real users. Those
	// accounts can sign in right away, so do that instead of treating it as a failure.
	const signInAfterSignUp = await postAuth('sign-in/email', { email, password })
	const tokenAfterSignUp = signInAfterSignUp.ok ? signInAfterSignUp.headers.get('set-auth-token') : null
	if (!tokenAfterSignUp) {
		throw new Error(`no set-auth-token header after sign-up+sign-in for ${email}: ${await signInAfterSignUp.text()}`)
	}
	return tokenAfterSignUp
}
