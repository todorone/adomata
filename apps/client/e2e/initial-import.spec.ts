import { expect, test } from '@playwright/test'

import { API_URL, SUPERADMIN, signInOrSignUp } from './fixtures'

async function deleteInitialImportAgencies(token: string) {
	const response = await fetch(`${API_URL}/admin/organizations`, { headers: { Authorization: `Bearer ${token}` } })
	expect(response.ok).toBe(true)
	const body = (await response.json()) as { organizations: Array<{ id: string; slug: string | null }> }
	for (const agency of body.organizations) {
		if (!agency.slug?.startsWith('initial-import-')) continue
		const deleted = await fetch(`${API_URL}/admin/organizations/${agency.id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		expect(deleted.ok).toBe(true)
	}
}

test('multiple Initial Imports publish independently and recover their failed progress after reload', async ({ page }) => {
	test.setTimeout(90_000)
	const token = await signInOrSignUp(SUPERADMIN)
	await deleteInitialImportAgencies(token)
	await page.goto('/login')
	await page.getByLabel('Email').fill(SUPERADMIN.email)
	await page.getByLabel('Пароль').fill(SUPERADMIN.password)
	await page.getByRole('button', { name: 'Увійти' }).click()
	await expect(page).toHaveURL(url => url.pathname === '/')

	const suffix = Date.now()
	const agencyName = `Імпорт E2E ${suffix}`
	await page.goto('/super/agencies')
	await page.getByRole('button', { name: 'Створити агенцію' }).click()
	const dialog = page.getByRole('dialog')
	await dialog.getByLabel('Назва агенції').fill(agencyName)
	await dialog.getByLabel('Слаг').fill(`initial-import-${suffix}`)
	await dialog.getByLabel('Електронна пошта власника агенції').fill(SUPERADMIN.email)
	await dialog.getByRole('button', { name: 'Створити', exact: true }).click()
	await expect(page.getByRole('cell', { name: agencyName, exact: true })).toBeVisible()

	const agencyId = await page.evaluate(async ({ apiUrl, name }) => {
		const response = await fetch(`${apiUrl}/me`, { credentials: 'include' })
		const body = (await response.json()) as { memberships: Array<{ id: string; name: string }> }
		return body.memberships.find(agency => agency.name === name)?.id
	}, { apiUrl: API_URL, name: agencyName })
	expect(agencyId).toBeTruthy()
	const switchStatus = await page.evaluate(async ({ apiUrl, organizationId }) => {
		const response = await fetch(`${apiUrl}/me/active-organization`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ organizationId }),
		})
		return response.status
	}, { apiUrl: API_URL, organizationId: agencyId })
	expect(switchStatus).toBe(204)
	await page.reload()

	await page.goto('/organization/settings')
	await page.getByLabel('Токен Meta').fill('fake-meta-token')
	await page.getByRole('button', { name: 'Зберегти' }).click()
	await page.getByRole('button', { name: 'Знайти рекламні кабінети' }).click()
	await expect(page.getByLabel('Funded prepay')).toBeVisible()
	await page.getByLabel('Funded prepay').check()
	await page.getByLabel('Throttled Account').check()
	await page.getByRole('button', { name: 'Підключити вибрані (2)' }).click()

	await expect(page.getByText('Funded prepay — Рекламний кабінет підключено')).toBeVisible()
	await expect(page.getByText('Throttled Account — Рекламний кабінет підключено')).toBeVisible()

	await expect(page.getByText('Throttled Account — початкове завантаження не вдалося')).toBeVisible({ timeout: 30_000 })

	await page.reload()
	await page.getByRole('button', { name: 'Знайти рекламні кабінети' }).click()
	await expect(page.getByText('Throttled Account — початкове завантаження не вдалося')).toBeVisible()

	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Огляд рекламних кабінетів' })).toBeVisible()
	await expect(page.getByText('Funded prepay')).toBeVisible({ timeout: 30_000 })

	await page.goto('/organization/settings')
	await page.getByRole('button', { name: 'Знайти рекламні кабінети' }).click()
	await page.getByRole('button', { name: 'Повторити' }).click()
	await expect(page.getByText('Throttled Account — Рекламний кабінет підключено')).toBeVisible()
	await expect(page.getByText('Throttled Account — початкове завантаження не вдалося')).toBeVisible({ timeout: 30_000 })

	await deleteInitialImportAgencies(token)
})
