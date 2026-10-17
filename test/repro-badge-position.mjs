// Run after build: node --test test/repro-badge-position.mjs
// The suite badge must sit in the same lower-left spot on every button: the
// standalone badge (macros, GPI, PBUS…) and the badge inside the labelled and
// timeline overlays (AUX, crosspoints, E-MEMs…) use one offset and one alignment.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { labeledButtonSvg, SUITE_BADGES, timelineProgressSvg } from '../dist/badges.js'

const svg = (base64) => Buffer.from(base64, 'base64').toString('utf8')
const badgeTransforms = (text) => [...text.matchAll(/<g transform="(translate\([^)]*\))">\s*<circle/g)].map((m) => m[1])

test('labelled and timeline overlays place the badge where the standalone badge is', () => {
	const [standalone] = badgeTransforms(svg(SUITE_BADGES[1]))
	assert.ok(standalone)
	assert.deepEqual(badgeTransforms(svg(labeledButtonSvg(1, 'AUX 1', 'SRC001', 0xffffff))), [standalone])
	assert.deepEqual(badgeTransforms(svg(timelineProgressSvg(1, 1, 2, false, 0, []))), [standalone])
})

test('every badge image is aligned the same way', () => {
	const dist = new URL('../dist/', import.meta.url)
	for (const file of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
		const alignments = [...readFileSync(new URL(file, dist), 'utf8').matchAll(/pngalignment: '([^']+)'/g)].map(
			(m) => m[1],
		)
		for (const alignment of alignments) assert.equal(alignment, 'center:bottom', `${file} uses ${alignment}`)
	}
})
