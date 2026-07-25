import { Component, type ErrorInfo, type ReactNode } from 'react'

import { ErrorFallback } from '@/components/error-fallback'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
	state: { error: unknown } = { error: null }

	static getDerivedStateFromError(error: unknown) {
		return { error }
	}

	componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error('Unhandled error caught by ErrorBoundary', error, info.componentStack)
	}

	render() {
		if (this.state.error) {
			return <ErrorFallback error={this.state.error} reset={() => this.setState({ error: null })} />
		}
		return this.props.children
	}
}
