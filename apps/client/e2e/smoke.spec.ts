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

test('a superadmin can send an invitation from the invitations page', async ({ page }) => {
	await signInOrSignUp(SUPERADMIN)

	await page.goto('/login')
	await page.getByLabel('Email').fill(SUPERADMIN.email)
	await page.getByLabel('Пароль').fill(SUPERADMIN.password)
	await page.getByRole('button', { name: 'Увійти' }).click()
	await expect(page).toHaveURL(url => url.pathname === '/')

	await page.goto('/users/invites')
	await page.getByRole('button', { name: 'Запросити користувача' }).click()

	const invitee = `e2e-invite-${Date.now()}@example.com`
	await page.getByLabel('Email').fill(invitee)
	await page.getByRole('button', { name: 'Надіслати запрошення' }).click()

	await expect(page.getByRole('cell', { name: invitee })).toBeVisible()
})

test('a user can log out from a Fleet Board URL', async ({ page }) => {
	await signInOrSignUp(SUPERADMIN)

	await page.goto('/login')
	await page.getByLabel('Email').fill(SUPERADMIN.email)
	await page.getByLabel('Пароль').fill(SUPERADMIN.password)
	await page.getByRole('button', { name: 'Увійти' }).click()
	await expect(page).toHaveURL(url => url.pathname === '/')

	await page.goto(
		'/?view=tree&range=today&metrics=%5B%22spend%22%2C%22roas%22%5D&depth=account&search=&needsAttention=false&sort=attention&direction=desc',
	)
	await expect(page.getByRole('heading', { name: 'Огляд рекламних кабінетів' })).toBeVisible()
	await page.getByRole('button', { name: `${SUPERADMIN.name} ${SUPERADMIN.email}` }).click()
	await page.getByRole('menuitem', { name: 'Вийти' }).click()

	await expect(page).toHaveURL(/\/login$/)
	await expect(page.getByRole('heading', { name: 'Увійдіть у свій акаунт' })).toBeVisible()
})
