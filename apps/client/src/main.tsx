import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import { ErrorBoundary } from '@/components/error-boundary'
import { ModalProvider } from '@/components/modal-provider'
import { QueryProvider } from '@/data/core/queryProvider'
import { getRouter } from './router'
import './styles.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
	throw new Error('Root element not found')
}

// The .dark token set already exists in styles.css; nothing reached it. No toggle and no
// persistence in this scope — the OS preference is the only input.
const darkPreference = window.matchMedia('(prefers-color-scheme: dark)')
const applyColorScheme = () => document.documentElement.classList.toggle('dark', darkPreference.matches)
applyColorScheme()
darkPreference.addEventListener('change', applyColorScheme)

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<ErrorBoundary>
			<QueryProvider>
				<ModalProvider>
					<RouterProvider router={getRouter()} />
				</ModalProvider>
			</QueryProvider>
		</ErrorBoundary>
	</React.StrictMode>,
)
