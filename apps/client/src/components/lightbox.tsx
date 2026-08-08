import { useRef, useState, type TouchEvent } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, Video } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/ui/dialog'

export type LightboxAsset = {
	key: string
	kind: 'image' | 'video'
	label: string
	mediaKey: string
}

export type LightboxMetadata = {
	title: string
	body: string | null
	description: string | null
	callToAction: string | null
	destination: string | null
}

type LightboxProps = {
	assets: LightboxAsset[]
	selectedAssetKey: string | null
	onSelectedAssetChange: (assetKey: string) => void
	mediaUnavailable: boolean
	mediaUrl: (mediaKey: string) => string
	metadata: LightboxMetadata
	hasMultipleAssets: boolean
}

export function Lightbox({
	assets,
	selectedAssetKey,
	onSelectedAssetChange,
	mediaUnavailable,
	mediaUrl,
	metadata,
	hasMultipleAssets,
}: LightboxProps) {
	const [open, setOpen] = useState(false)
	const [failedMediaKeys, setFailedMediaKeys] = useState<Set<string>>(new Set())
	const touchStartX = useRef<number | null>(null)
	const selectedAsset = assets.find(asset => asset.key === selectedAssetKey) ?? assets[0]

	if (!selectedAsset) return null

	const selectedIndex = assets.findIndex(asset => asset.key === selectedAsset.key)
	const previousAsset = assets[selectedIndex - 1]
	const nextAsset = assets[selectedIndex + 1]

	function selectAsset(asset: LightboxAsset) {
		onSelectedAssetChange(asset.key)
	}

	function openAsset(asset: LightboxAsset) {
		selectAsset(asset)
		setOpen(true)
	}

	function moveTo(asset: LightboxAsset | undefined) {
		if (asset) selectAsset(asset)
	}

	function markMediaFailed(assetKey: string) {
		setFailedMediaKeys(current => new Set(current).add(assetKey))
	}

	function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
		touchStartX.current = event.touches[0]?.clientX ?? null
	}

	function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
		if (touchStartX.current === null) return
		const endX = event.changedTouches[0]?.clientX
		const distance = endX === undefined ? 0 : endX - touchStartX.current
		touchStartX.current = null
		if (Math.abs(distance) < 48) return
		moveTo(distance > 0 ? previousAsset : nextAsset)
	}

	function mediaFallback(asset: LightboxAsset) {
		return (
			<div className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-2 bg-muted p-6 text-center text-sm text-muted-foreground">
				<ImageOff size={28} aria-hidden="true" />
				<span>Медіафайл «{asset.label}» тимчасово недоступний.</span>
			</div>
		)
	}

	function renderInlineMedia(asset: LightboxAsset) {
		if (mediaUnavailable || failedMediaKeys.has(asset.key)) return mediaFallback(asset)
		if (asset.kind === 'video') {
			return (
				<video
					aria-label={asset.label}
					className="aspect-video max-h-[36rem] w-full bg-black object-contain"
					preload="metadata"
					src={mediaUrl(asset.mediaKey)}
					onError={() => markMediaFailed(asset.key)}
				/>
			)
		}
		return (
			<img
				src={mediaUrl(asset.mediaKey)}
				alt=""
				className="max-h-[36rem] w-full object-contain"
				onError={() => markMediaFailed(asset.key)}
			/>
		)
	}

	function renderDialogMedia(asset: LightboxAsset) {
		if (mediaUnavailable || failedMediaKeys.has(asset.key)) return mediaFallback(asset)
		if (asset.kind === 'video') {
			return (
				<video
					key={asset.key}
					aria-label={asset.label}
					className="max-h-full max-w-full object-contain"
					controls
					preload="metadata"
					src={mediaUrl(asset.mediaKey)}
					onError={() => markMediaFailed(asset.key)}
				/>
			)
		}
		return (
			<img
				src={mediaUrl(asset.mediaKey)}
				alt={asset.label}
				className="max-h-full max-w-full object-contain"
				onError={() => markMediaFailed(asset.key)}
			/>
		)
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<div className="mt-3 overflow-hidden rounded-md border bg-background">
				<DialogTrigger asChild>
					<button
						type="button"
						className="block w-full cursor-zoom-in text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
						onClick={() => openAsset(selectedAsset)}
						aria-label={`Відкрити креатив у повноекранному перегляді: ${selectedAsset.label}`}
					>
						{renderInlineMedia(selectedAsset)}
					</button>
				</DialogTrigger>
			</div>

			{assets.length > 1 ? (
				<nav className="mt-3 flex flex-wrap gap-2" aria-label="Варіанти креативу">
					{assets.map(asset => (
						<DialogTrigger key={asset.key} asChild>
							<button
								type="button"
								className="w-28 overflow-hidden rounded-md border bg-background text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
								onClick={() => openAsset(asset)}
								aria-label={`Відкрити варіант «${asset.label}» у повноекранному перегляді`}
								aria-pressed={selectedAsset.key === asset.key}
							>
								{asset.kind === 'video' ? (
									<div className="flex aspect-square items-center justify-center bg-muted text-muted-foreground">
										<Video size={24} aria-hidden="true" />
									</div>
								) : (
									<img
										src={mediaUrl(asset.mediaKey)}
										alt=""
										className="aspect-square w-full object-cover"
										onError={() => markMediaFailed(asset.key)}
									/>
								)}
								<p className="truncate px-2 py-1 text-xs">{asset.label}</p>
							</button>
						</DialogTrigger>
					))}
				</nav>
			) : null}

			<DialogContent
				className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)]"
				showCloseButton
			>
				<DialogHeader className="shrink-0 border-b px-4 py-3 pr-14 sm:px-6">
					<DialogTitle className="truncate">{metadata.title}</DialogTitle>
					<DialogDescription>
						Варіант {selectedIndex + 1} з {assets.length}: {selectedAsset.label}
					</DialogDescription>
				</DialogHeader>

				<div className="grid min-h-0 flex-1 sm:grid-cols-[minmax(0,1fr)_20rem]">
					<section
						className="flex min-h-0 min-w-0 flex-col bg-black/90 p-3 sm:p-5"
						aria-label="Перегляд медіафайлу"
					>
						<div
							className="flex min-h-0 flex-1 touch-pan-y select-none items-center justify-center gap-2"
							onTouchStart={handleTouchStart}
							onTouchEnd={handleTouchEnd}
						>
							<button
								type="button"
								className="shrink-0 rounded-md p-2 text-white outline-offset-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-30"
								onClick={() => moveTo(previousAsset)}
								disabled={!previousAsset}
								aria-label="Попередній варіант креативу"
							>
								<ChevronLeft size={24} aria-hidden="true" />
							</button>
							<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
								{renderDialogMedia(selectedAsset)}
							</div>
							<button
								type="button"
								className="shrink-0 rounded-md p-2 text-white outline-offset-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-30"
								onClick={() => moveTo(nextAsset)}
								disabled={!nextAsset}
								aria-label="Наступний варіант креативу"
							>
								<ChevronRight size={24} aria-hidden="true" />
							</button>
						</div>

						{assets.length > 1 ? (
							<div className="mt-3 flex shrink-0 gap-2 overflow-x-auto pb-1" aria-label="Навігація варіантами">
								{assets.map(asset => (
									<button
										key={asset.key}
										type="button"
										className="w-20 shrink-0 overflow-hidden rounded-md border border-white/30 bg-white/10 text-left text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-white aria-pressed:border-white"
										onClick={() => selectAsset(asset)}
										aria-label={`Показати варіант «${asset.label}»`}
										aria-pressed={selectedAsset.key === asset.key}
									>
										{asset.kind === 'video' ? (
											<div className="flex aspect-square items-center justify-center bg-white/10 text-white/70">
												<Video size={20} aria-hidden="true" />
											</div>
										) : (
											<img
												src={mediaUrl(asset.mediaKey)}
												alt=""
												className="aspect-square w-full object-cover"
												onError={() => markMediaFailed(asset.key)}
											/>
										)}
										<span className="block truncate px-1 py-1 text-[11px]">{asset.label}</span>
									</button>
								))}
							</div>
						) : null}
					</section>

					<aside className="min-h-0 overflow-y-auto border-t bg-background p-4 sm:border-t-0 sm:border-l sm:p-5">
						<div className="space-y-3 text-sm">
							<p className="font-medium">{selectedAsset.label}</p>
							{metadata.body ? (
								<p className="whitespace-pre-wrap text-muted-foreground">{metadata.body}</p>
							) : null}
							{metadata.description ? <p className="text-muted-foreground">{metadata.description}</p> : null}
							{metadata.callToAction ? (
								<p className="text-muted-foreground">Дія: {metadata.callToAction}</p>
							) : null}
							{metadata.destination ? (
								<a
									className="block text-primary underline"
									href={metadata.destination}
									target="_blank"
									rel="noreferrer noopener"
								>
									Перейти за посиланням
								</a>
							) : null}
							{hasMultipleAssets ? (
								<p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
									Результати належать оголошенню цілком
								</p>
							) : null}
							{mediaUnavailable ? (
								<p className="flex items-center gap-2 text-xs text-muted-foreground">
									<ImageOff size={15} aria-hidden="true" />
									Медіафайл тимчасово недоступне
								</p>
							) : null}
						</div>
					</aside>
				</div>
			</DialogContent>
		</Dialog>
	)
}
