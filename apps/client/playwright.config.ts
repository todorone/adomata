import { existsSync } from 'node:fs'

import { defineConfig, devices } from '@playwright/test'

// Load apps/client/.env (E2E_* credentials + VITE_API_URL) into process.env so
// spec files' HTTP helpers can reach the API. Node's native loader — no
// dotenv dependency. The file is gitignored and only present locally.
if (existsSync(new URL('.env', import.meta.url))) {
	process.loadEnvFile(new URL('.env', import.meta.url).pathname)
}

const baseURL = process.env['CLIENT_URL'] ?? 'http://localhost:5173'
const apiURL = process.env['VITE_API_URL'] ?? 'http://localhost:3000'
const clientPort = new URL(baseURL).port || '5173'
const apiPort = new URL(apiURL).port || '3000'
const e2eSuperadminEmail = process.env['E2E_SUPERADMIN_EMAIL'] ?? process.env['SUPERADMIN_EMAIL'] ?? 'super@adomata.com'
const e2eSuperadminPassword = process.env['E2E_SUPERADMIN_PASSWORD'] ?? 'e2e-ci-superadmin-password'

// Keep local E2E runs aligned with the API process that Playwright starts below.
// CI can override these values through the workflow environment.
const e2eEnvironment = {
	...process.env,
	CLIENT_URL: baseURL,
	VITE_API_URL: apiURL,
	PORT: apiPort,
	BASE_URL: apiURL,
	BETTER_AUTH_URL: apiURL,
	SUPERADMIN_EMAIL: e2eSuperadminEmail,
	E2E_SUPERADMIN_EMAIL: e2eSuperadminEmail,
	E2E_SUPERADMIN_PASSWORD: e2eSuperadminPassword,
	META_API_MODE: process.env['META_API_MODE'] ?? 'fake',
	HEARTBEAT_SECRET: process.env['HEARTBEAT_SECRET'] ?? 'e2e-heartbeat-secret',
}

export default defineConfig({
	testDir: './e2e',
	workers: 1,
	fullyParallel: false,
	forbidOnly: Boolean(process.env['CI']),
	reporter: 'list',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'pnpm dev',
			cwd: '../api',
			url: `${apiURL}/health`,
			reuseExistingServer: true,
			timeout: 120_000,
			env: e2eEnvironment,
		},
		{
			command: `pnpm exec vite dev --port ${clientPort}`,
			url: baseURL,
			reuseExistingServer: true,
			timeout: 120_000,
			env: e2eEnvironment,
		},
	],
})
