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
