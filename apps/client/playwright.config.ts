import { existsSync } from 'node:fs'

import { defineConfig, devices } from '@playwright/test'

// Load apps/client/.env (E2E_* credentials + VITE_API_URL) into process.env so
// spec files' HTTP helpers can reach the API. Node's native loader — no
// dotenv dependency. The file is gitignored and only present locally.
if (existsSync(new URL('.env', import.meta.url))) {
	process.loadEnvFile(new URL('.env', import.meta.url).pathname)
}

const baseURL = process.env['CLIENT_URL'] ?? 'http://localhost:5173'

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
	webServer: {
		command: 'pnpm dev',
		url: baseURL,
		reuseExistingServer: true,
		timeout: 120_000,
	},
})
