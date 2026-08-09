import { useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, Video } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog'

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
	open: boolean
	onOpenChange: (open: boolean) => void
	assets: LightboxAsset[]
	selectedAssetKey: string | null
	onSelectedAssetChange: (assetKey: string) => void
	mediaUnavailable: boolean
	// Meta doesn't grant raw video-file access to third-party apps, so a video-only Creative
	// whose file can't be streamed falls back to Meta's own hosted preview iframe here instead.
	adPreviewUrl: string | null
	mediaUrl: (mediaKey: string) => string
	metadata: LightboxMetadata
	hasMultipleAssets: boolean
	children?: ReactNode
}

export function Lightbox({
	open,
	onOpenChange,
	assets,
	selectedAssetKey,
	onSelectedAssetChange,
	mediaUnavailable,
	adPreviewUrl,
	mediaUrl,
	metadata,
	hasMultipleAssets,
	children,
}: LightboxProps) {
	const [failedMediaKeys, setFailedMediaKeys] = useState<Set<string>>(new Set())
	const touchStartX = useRef<number | null>(null)
	const selectedAsset = assets.find(asset => asset.key === selectedAssetKey) ?? assets[0]
	const hasMedia = selectedAsset !== undefined
	// No streamable asset at all, but Meta's hosted preview stands in for one.
	const showAdPreview = !hasMedia && adPreviewUrl !== null
	const showMediaPanel = hasMedia || showAdPreview

	const selectedIndex = hasMedia ? assets.findIndex(asset => asset.key === selectedAsset.key) : -1
	const previousAsset = assets[selectedIndex - 1]
	const nextAsset = assets[selectedIndex + 1]

	function selectAsset(asset: LightboxAsset) {
		onSelectedAssetChange(asset.key)
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
			<div className="flex h-full min-h-48 w-80 flex-col items-center justify-center gap-2 bg-muted p-6 text-center text-sm text-muted-foreground">
				<ImageOff size={28} aria-hidden="true" />
				<span>Медіафайл «{asset.label}» тимчасово недоступний.</span>
			</div>
		)
	}

	function renderDialogMedia(asset: LightboxAsset) {
		if (mediaUnavailable || failedMediaKeys.has(asset.key)) return mediaFallback(asset)
		if (asset.kind === 'video') {
			return (
				<video
					key={asset.key}
					aria-label={asset.label}
					className="h-full w-full object-contain"
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
				className="h-full w-full object-contain"
				onError={() => markMediaFailed(asset.key)}
			/>
		)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none"
				showCloseButton
			>
				<DialogHeader className="shrink-0 border-b px-4 py-3 pr-14 sm:px-6">
					<DialogTitle className="truncate">{metadata.title}</DialogTitle>
					{hasMedia ? (
						<DialogDescription>
							Варіант {selectedIndex + 1} з {assets.length}: {selectedAsset.label}
						</DialogDescription>
					) : showAdPreview ? (
						<DialogDescription>Попередній перегляд від Meta</DialogDescription>
					) : (
						<DialogDescription className="sr-only">Деталі креативу</DialogDescription>
					)}
				</DialogHeader>

				<div
					className={
						showMediaPanel ? 'grid min-h-0 flex-1 sm:grid-cols-[minmax(0,1fr)_20rem]' : 'grid min-h-0 flex-1'
					}
				>
					{showMediaPanel ? (
						<section
							className="flex min-h-0 min-w-0 flex-col bg-black/90 px-3 sm:px-5"
							aria-label="Перегляд медіафайлу"
						>
							<div
								className="relative flex min-h-0 flex-1 touch-pan-y select-none items-center justify-center"
								onTouchStart={handleTouchStart}
								onTouchEnd={handleTouchEnd}
							>
								{previousAsset ? (
									<button
										type="button"
										className="absolute left-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white outline-offset-2 hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-white sm:left-4"
										onClick={() => moveTo(previousAsset)}
										aria-label="Попередній варіант креативу"
									>
										<ChevronLeft size={28} aria-hidden="true" />
									</button>
								) : null}
								<div className="flex h-full min-h-0 min-w-0 items-center justify-center">
									{showAdPreview ? (
										<iframe
											key="ad-preview"
											src={adPreviewUrl!}
											title="Попередній перегляд від Meta"
											className="h-[640px] max-h-full w-[360px] max-w-full border-0"
											sandbox="allow-scripts allow-same-origin"
											allow="autoplay; encrypted-media"
										/>
									) : (
										renderDialogMedia(selectedAsset!)
									)}
								</div>
								{nextAsset ? (
									<button
										type="button"
										className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white outline-offset-2 hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-white sm:right-4"
										onClick={() => moveTo(nextAsset)}
										aria-label="Наступний варіант креативу"
									>
										<ChevronRight size={28} aria-hidden="true" />
									</button>
								) : null}
							</div>

							{assets.length > 1 ? (
								<div
									className="mt-3 flex w-full shrink-0 gap-2 overflow-x-auto pb-1"
									aria-label="Навігація варіантами"
								>
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
					) : null}

					<aside
						className={
							showMediaPanel
								? 'min-h-0 overflow-y-auto border-t bg-background p-4 sm:border-t-0 sm:border-l sm:p-5'
								: 'min-h-0 overflow-y-auto bg-background p-4 sm:p-5'
						}
					>
						<div className="space-y-3 text-sm">
							{hasMedia ? <p className="font-medium">{selectedAsset.label}</p> : null}
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
							{mediaUnavailable && !showAdPreview ? (
								<p className="flex items-center gap-2 text-xs text-muted-foreground">
									<ImageOff size={15} aria-hidden="true" />
									Медіафайл тимчасово недоступне
								</p>
							) : null}
							{children}
						</div>
					</aside>
				</div>
			</DialogContent>
		</Dialog>
	)
}
