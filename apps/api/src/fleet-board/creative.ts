type CreativeRecord = { id: string; adId: string; name: string | null; payload: unknown }
type AssetKind = 'image' | 'video' | 'text' | 'link' | 'cta' | 'placement'
type CreativeAsset = { key: string; kind: AssetKind; label: string; value: string | null; mediaKey: string | null }

export function normalizeCreative(creative: CreativeRecord) {
	const payload = objectPayload(creative.payload)
	const story = objectPayload(payload.object_story_spec)
	const linkData = objectPayload(story.link_data)
	const childAttachments = arrayPayload(linkData.child_attachments)
	const assetFeed = objectPayload(payload.asset_feed_spec)
	const assets: CreativeAsset[] = mediaEntries(payload).map((entry, index) => ({
		key: `m${index}`,
		kind: entry.kind,
		label: entry.label,
		value: null,
		mediaKey: `m${index}`,
	}))
	assets.push(...assetFeedEntries(assetFeed))
	const kind =
		childAttachments.length > 0
			? 'carousel'
			: Object.keys(assetFeed).length > 0
				? 'asset_feed'
				: payload.video_id
					? 'video'
					: payload.object_url
						? 'existing_post'
						: payload.image_url
							? 'image'
							: 'unknown'
	return {
		id: creative.id,
		adId: creative.adId,
		name: creative.name,
		kind,
		body: stringValue(linkData.message) ?? stringValue(story.message),
		headline: stringValue(linkData.name),
		description: stringValue(linkData.description),
		callToAction: stringValue(objectPayload(linkData.call_to_action).type),
		destination: urlValue(linkData.link) ?? urlValue(linkData.website_url) ?? urlValue(payload.object_url),
		existingPostId:
			stringValue(payload.effective_object_story_id) ??
			stringValue(payload.effective_instagram_media_id) ??
			stringValue(payload.object_url),
		assets,
		mediaUnavailable: assets.every(asset => asset.mediaKey === null),
	}
}

export function needsCreativeMediaRefresh(creative: Pick<CreativeRecord, 'payload'>) {
	const payload = objectPayload(creative.payload)
	const images = arrayPayload(objectPayload(payload.asset_feed_spec).images)
	return images.some(image => {
		const record = objectPayload(image)
		return Boolean(stringValue(record.hash) && !urlValue(record.url))
	})
}

export function mediaUrlForKey(creative: Pick<CreativeRecord, 'payload'>, key: string) {
	const payload = objectPayload(creative.payload)
	if (key === 'thumb') return urlValue(payload.thumbnail_url) ?? urlValue(payload.image_url)
	const index = /^m(\d+)$/.exec(key)?.[1]
	if (index !== undefined) return mediaEntries(payload)[Number(index)]?.url ?? null
	const assetMatch = /^a-images-(\d+)$/.exec(key)
	if (!assetMatch) return null
	const assetFeed = objectPayload(payload.asset_feed_spec)
	const asset = objectPayload(arrayPayload(assetFeed.images)[Number(assetMatch[1])])
	return urlValue(asset.url)
}

function objectPayload(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function arrayPayload(value: unknown) {
	return Array.isArray(value) ? value : []
}

function stringValue(value: unknown) {
	return typeof value === 'string' ? value : null
}

function urlValue(value: unknown) {
	const url = stringValue(value)
	if (!url) return null
	try {
		return new URL(url).toString()
	} catch {
		return null
	}
}

function mediaEntries(payload: Record<string, unknown>) {
	const entries: Array<{ url: string; kind: 'image' | 'video'; label: string }> = []
	const add = (value: unknown, kind: 'image' | 'video', label: string) => {
		if (typeof value === 'string' && /^https:\/\//.test(value)) entries.push({ url: value, kind, label })
	}
	add(payload.image_url, 'image', 'Зображення')
	add(payload.video_url, 'video', 'Відео')
	const assetFeed = objectPayload(payload.asset_feed_spec)
	for (const [index, video] of arrayPayload(assetFeed.videos).entries()) {
		add(objectPayload(video).video_url, 'video', `Відео ${index + 1}`)
	}
	const story = objectPayload(payload.object_story_spec)
	const linkData = objectPayload(story.link_data)
	for (const [index, attachment] of arrayPayload(linkData.child_attachments).entries()) {
		add(objectPayload(attachment).picture, 'image', `Картка ${index + 1}`)
	}
	return entries
}

function assetFeedEntries(assetFeed: Record<string, unknown>): CreativeAsset[] {
	const entries: CreativeAsset[] = []
	const add = (field: string, kind: AssetKind, label: string, valueFields: string[]) => {
		for (const [index, item] of arrayPayload(assetFeed[field]).entries()) {
			const record = objectPayload(item)
			const mediaKey = field === 'images' && urlValue(record.url) ? `a-images-${index}` : null
			entries.push({
				key: `a-${field}-${index}`,
				kind,
				label: `${label} ${index + 1}`,
				value: valueFields.map(fieldName => stringValue(record[fieldName])).find(Boolean) ?? null,
				mediaKey,
			})
		}
	}
	add('images', 'image', 'Зображення', ['hash', 'url'])
	add('videos', 'video', 'Відео', ['video_id'])
	add('bodies', 'text', 'Основний текст', ['text'])
	add('titles', 'text', 'Заголовок', ['text'])
	add('descriptions', 'text', 'Опис', ['text'])
	add('link_urls', 'link', 'Посилання', ['website_url', 'display_url', 'url'])
	add('call_to_actions', 'cta', 'Заклик до дії', ['type'])
	for (const [index, rule] of arrayPayload(assetFeed.asset_customization_rules).entries()) {
		const record = objectPayload(rule)
		const placement = objectPayload(record.customization_spec)
		const placementNames = [
			...arrayPayload(placement.publisher_platforms),
			...arrayPayload(placement.facebook_positions),
			...arrayPayload(placement.instagram_positions),
			...arrayPayload(placement.audience_network_positions),
			...arrayPayload(placement.messenger_positions),
		]
			.filter((value): value is string => typeof value === 'string')
			.join(', ')
		const labels = [
			'image_label',
			'video_label',
			'body_label',
			'title_label',
			'description_label',
			'link_url_label',
			'call_to_action_label',
		]
			.map(field => stringValue(record[field]))
			.filter((value): value is string => value !== null)
		entries.push({
			key: `a-placement-${index}`,
			kind: 'placement',
			label: `Розміщення ${index + 1}`,
			value: [placementNames, labels.join(', ')].filter(Boolean).join(' — ') || null,
			mediaKey: null,
		})
	}
	return entries
}
