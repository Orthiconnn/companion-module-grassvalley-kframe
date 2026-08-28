const SUITE_NUMBER_PATHS: Record<number, string> = {
	1: 'M31 312 L38 305 L38 338 M30 338 L46 338',
	2: 'M28 312 Q30 304 39 304 Q48 304 48 313 Q48 319 42 324 L28 338 L49 338',
	3: 'M29 309 Q33 304 40 304 Q48 304 48 313 Q48 321 39 321 M39 321 Q49 321 49 330 Q49 339 40 339 Q32 339 28 334',
	4: 'M46 339 L46 304 L27 327 L52 327',
}

const badgeSvg = (suite: number): string => `
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
	<g transform="translate(24 -24)">
		<circle cx="38" cy="322" r="31" fill="#050505" stroke="#00cfd5" stroke-width="6"/>
		<path d="${SUITE_NUMBER_PATHS[suite]}" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
	</g>
</svg>`

const escapeXml = (value: string): string =>
	value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * Draw a button's independently positioned heading and source label together
 * with its suite badge. Companion exposes only one alignment for normal text,
 * so a vector overlay is required to keep the heading at the top while the
 * source remains centered.
 */
export const labeledButtonSvg = (suite: number, heading: string, source: string, color: number): string => {
	const textColor = `#${color.toString(16).padStart(6, '0')}`
	const sourceSize = Math.max(26, Math.min(60, Math.floor(580 / Math.max(source.length, 1))))
	const sourceWidthLimit = source.length > 20 ? ' textLength="300" lengthAdjust="spacingAndGlyphs"' : ''
	return Buffer.from(
		`
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
	<g fill="${textColor}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="500">
		<text x="180" y="54" font-size="58" dominant-baseline="middle">${escapeXml(heading)}</text>
		<text x="180" y="190" font-size="${sourceSize}" dominant-baseline="middle"${sourceWidthLimit}>${escapeXml(source)}</text>
	</g>
	<g transform="translate(24 -24)">
		<circle cx="38" cy="322" r="31" fill="#050505" stroke="#00cfd5" stroke-width="6"/>
		<path d="${SUITE_NUMBER_PATHS[suite]}" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
	</g>
</svg>`,
	).toString('base64')
}

export const timelineProgressSvg = (
	suite: number,
	cursorTime: number,
	duration: number,
	paused: boolean,
	phase: number,
): string => {
	const progress = Math.max(0, Math.min(1, duration > 0 ? cursorTime / duration : 0))
	const dotX = 48 + progress * 264
	const pulseStep = ((phase % 8) + 8) % 8
	const dotRadius = paused ? 13 + 3 * Math.sin((pulseStep * Math.PI) / 4) : 13
	const rings = paused
		? [0, 3, 6]
				.map((offset) => {
					const step = (pulseStep + offset) % 8
					const radius = 20 + step * 5
					const opacity = Math.max(0, 0.75 * (1 - step / 8))
					return `<circle cx="${dotX.toFixed(2)}" cy="238" r="${radius}" fill="none" stroke="#7ffcff" stroke-width="5" opacity="${opacity.toFixed(2)}"/>`
				})
				.join('')
		: ''
	return Buffer.from(
		`
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
	<line x1="48" y1="238" x2="312" y2="238" stroke="#18383d" stroke-width="20" stroke-linecap="round"/>
	<line x1="48" y1="238" x2="${dotX.toFixed(2)}" y2="238" stroke="#7ffcff" stroke-width="12" stroke-linecap="round"/>
	${rings}
	<circle cx="${dotX.toFixed(2)}" cy="238" r="${dotRadius.toFixed(2)}" fill="#ffffff" stroke="#00cfd5" stroke-width="6"/>
	<g transform="translate(24 -24)">
		<circle cx="38" cy="322" r="31" fill="#050505" stroke="#00cfd5" stroke-width="6"/>
		<path d="${SUITE_NUMBER_PATHS[suite]}" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
	</g>
</svg>`,
	).toString('base64')
}

/**
 * Suite indicators are authored as vectors. Companion's button-style API only
 * exposes the historical `png64` bitmap slot, but its renderer accepts SVG
 * image bytes there and rasterizes them at the target surface resolution.
 */
export const SUITE_BADGES: Record<number, string> = Object.fromEntries(
	[1, 2, 3, 4].map((suite) => [suite, Buffer.from(badgeSvg(suite)).toString('base64')]),
)

/** A valid transparent PNG used to explicitly clear a preset's fallback badge. */
export const CLEAR_BADGE =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=='
