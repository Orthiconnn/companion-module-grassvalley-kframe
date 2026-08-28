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
export const labeledButtonSvg = (
	suite: number,
	heading: string,
	source: string,
	color: number,
	transition?: { ramp: number; active: boolean },
	textScale = 1,
): string => {
	const textColor = `#${color.toString(16).padStart(6, '0')}`
	const scale = Math.max(0.5, Math.min(2, textScale))
	const headingSize = Math.round(58 * scale)
	const sourceSize = Math.round(Math.max(26, Math.min(60, Math.floor(580 / Math.max(source.length, 1)))) * scale)
	const sourceWidthLimit = source.length > 20 ? ' textLength="300" lengthAdjust="spacingAndGlyphs"' : ''
	const transitionProgress = Math.max(0, Math.min(1, transition?.ramp ?? 0))
	const transitionHeight = transitionProgress * 280
	const transitionStrip = transition?.active
		? `<rect x="322" y="${(316 - transitionHeight).toFixed(2)}" width="28" height="${transitionHeight.toFixed(2)}" rx="3" fill="#98e700" stroke="#315f00" stroke-width="5"/>`
		: ''
	return Buffer.from(
		`
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
	<g fill="${textColor}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="500">
		<text x="180" y="54" font-size="${headingSize}" dominant-baseline="middle">${escapeXml(heading)}</text>
		<text x="180" y="190" font-size="${sourceSize}" dominant-baseline="middle"${sourceWidthLimit}>${escapeXml(source)}</text>
	</g>
	${transitionStrip}
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
	pausePoints: number[],
): string => {
	const progress = Math.max(0, Math.min(1, duration > 0 ? cursorTime / duration : 0))
	const dotX = 48 + progress * 264
	const trackY = 64
	const pulseStep = ((phase % 16) + 16) % 16
	const dotRadius = paused ? 17 + 4 * Math.sin((pulseStep * Math.PI) / 8) : 17
	const rings = paused
		? [0]
				.map((offset) => {
					const step = (pulseStep + offset) % 16
					const radius = 20 + step * 2.625
					const opacity = Math.max(0, 0.72 * (1 - step / 16))
					return `<circle cx="${dotX.toFixed(2)}" cy="${trackY}" r="${radius.toFixed(2)}" fill="none" stroke="#9a3f00" stroke-width="5" opacity="${opacity.toFixed(2)}"/>`
				})
				.join('')
		: ''
	const pauseTolerance = Math.max(duration / 264, 0.01)
	const pauseDiamonds = pausePoints
		.filter((time) => Number.isFinite(time) && time >= 0 && time <= duration)
		.filter((time) => !(paused && Math.abs(time - cursorTime) <= pauseTolerance))
		.map((time) => {
			const x = 48 + (time / duration) * 264
			return `<polygon points="${x.toFixed(2)},${trackY - 20} ${(x + 20).toFixed(2)},${trackY} ${x.toFixed(2)},${trackY + 20} ${(x - 20).toFixed(2)},${trackY}" fill="#ff8c00" stroke="#8f3900" stroke-width="5"/>`
		})
		.join('')
	const dotFill = paused ? '#ff8c00' : '#98e700'
	const dotStroke = paused ? '#b84a00' : '#4c7300'
	return Buffer.from(
		`
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
	<line x1="48" y1="${trackY}" x2="312" y2="${trackY}" stroke="#17351c" stroke-width="26" stroke-linecap="round"/>
	<line x1="48" y1="${trackY}" x2="${dotX.toFixed(2)}" y2="${trackY}" stroke="#98e700" stroke-width="18" stroke-linecap="round"/>
	${pauseDiamonds}
	${rings}
	<circle cx="${dotX.toFixed(2)}" cy="${trackY}" r="${dotRadius.toFixed(2)}" fill="${dotFill}" stroke="${dotStroke}" stroke-width="6"/>
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
