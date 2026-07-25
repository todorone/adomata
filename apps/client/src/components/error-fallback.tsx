import { useState } from 'react'
import { Check, Copy, TriangleAlert } from 'lucide-react'

import { Button } from '@/ui/button'

function formatDevDetails(error: unknown): string {
	if (error instanceof Error) {
		return [error.name, error.message, error.stack].filter(Boolean).join('\n')
	}
	return String(error)
}

function fallbackCopy(text: string): boolean {
	const textarea = document.createElement('textarea')
	textarea.value = text
	textarea.style.position = 'fixed'
	textarea.style.opacity = '0'
	document.body.appendChild(textarea)
	textarea.select()
	const ok = document.execCommand('copy')
	document.body.removeChild(textarea)
	return ok
}

export function ErrorFallback({ error, reset }: { error: unknown; reset?: () => void }) {
	const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
	const details = formatDevDetails(error)

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(details)
			setCopyState('copied')
		} catch {
			setCopyState(fallbackCopy(details) ? 'copied' : 'failed')
		}
		setTimeout(() => setCopyState('idle'), 2000)
	}

	return (
		<div className="flex min-h-svh w-full items-center justify-center p-4">
			<div className="flex w-full max-w-lg flex-col gap-4 rounded-lg border p-6 shadow-sm">
				<div className="flex items-center gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
						<TriangleAlert className="size-5 text-destructive" />
					</div>
					<div>
						<h1 className="text-lg font-semibold">Щось пішло не так</h1>
						<p className="text-sm text-muted-foreground">
							Сталася непередбачена помилка. Спробуйте оновити сторінку.
						</p>
					</div>
				</div>

				<div className="flex gap-2">
					<Button onClick={() => (reset ? reset() : window.location.reload())}>Оновити сторінку</Button>
					<Button variant="outline" onClick={() => window.location.assign('/')}>
						На головну
					</Button>
				</div>

				<details className="rounded-md border bg-muted/40 text-sm">
					<summary className="cursor-pointer select-none px-3 py-2 font-medium">
						Технічні деталі (для розробників)
					</summary>
					<div className="flex flex-col gap-2 border-t p-3">
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
							{details}
						</pre>
						<Button variant="secondary" size="sm" className="self-start" onClick={handleCopy}>
							{copyState === 'copied' ? <Check /> : <Copy />}
							{copyState === 'copied'
								? 'Скопійовано'
								: copyState === 'failed'
									? 'Не вдалося скопіювати'
									: 'Копіювати деталі'}
						</Button>
					</div>
				</details>
			</div>
		</div>
	)
}
