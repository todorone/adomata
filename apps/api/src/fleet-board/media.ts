export function mediaRange(value: string | undefined) {
	return value && /^bytes=(?:\d+-\d*|-\d+)$/.test(value) ? value : undefined
}

export async function fetchCreativeMedia(url: string | null, range: string | undefined) {
	if (!url) return null
	try {
		const response = await fetch(url, { headers: range ? { Range: range } : undefined })
		const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
		if (!response.ok || !response.body || (!contentType.startsWith('image/') && !contentType.startsWith('video/')))
			return null
		return {
			body: response.body,
			contentType,
			status: response.status === 206 ? (206 as const) : (200 as const),
			contentLength: response.headers.get('content-length'),
			contentRange: response.headers.get('content-range'),
			acceptRanges: response.headers.get('accept-ranges'),
		}
	} catch {
		return null
	}
}
