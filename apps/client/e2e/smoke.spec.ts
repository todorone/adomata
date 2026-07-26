import { expect, test } from '@playwright/test'

import { API_URL, SUPERADMIN, signInOrSignUp } from './fixtures'

// Stack bring-up smoke test: exercises client + API + Postgres end to end.
// Real feature specs land as the product grows past this infra pass.

test('unauthenticated visitors are redirected to the login page', async ({ page }) => {
	await page.goto('/')
	await expect(page).toHaveURL(/\/login$/)
	await expect(page.getByRole('heading', { name: 'Увійдіть у свій акаунт' })).toBeVisible()
})

test('a superadmin can authenticate against the API and list organizations', async ({ request }) => {
	const token = await signInOrSignUp(SUPERADMIN)

	const res = await request.get(`${API_URL}/admin/organizations`, {
		headers: { Authorization: `Bearer ${token}` },
	})

	expect(res.ok()).toBe(true)
	const body = (await res.json()) as { organizations: unknown[] }
	expect(Array.isArray(body.organizations)).toBe(true)
})
