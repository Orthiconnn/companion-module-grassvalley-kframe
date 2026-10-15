// Run after build: node --test test/repro-auto-labels.mjs
// Button text follows the action options for every action with a label. No sockets or commands.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { UpdateFeedbacks } from '../dist/feedbacks.js'
import { UpdatePresets } from '../dist/presets.js'
import { buildPbusTrigger } from '../dist/legacy-actions.js'

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'pbus-label' })
	module.checkFeedbacks = () => {}
	let actions, feedbacks, presets
	module.setActionDefinitions = (defs) => (actions = defs)
	module.setFeedbackDefinitions = (defs) => (feedbacks = defs)
	module.setPresetDefinitions = (_sections, defs) => (presets = defs)
	UpdateActions(module)
	UpdateFeedbacks(module)
	return {
		module,
		actions,
		feedbacks,
		get presets() {
			return presets
		},
	}
}
const action = (id, options, controlId = 'button') => ({
	id,
	controlId,
	options: { suite: 'suite1a', pbus: 1, textSize: 100, showSuite: true, labelOverride: '', ...options },
})
const text = (feedbacks, automaticLabel = true) =>
	feedbacks.pbus_button_state.callback({ controlId: 'button', options: { automaticLabel } }).text

test('changing the recall register updates the button text', () => {
	const { actions, feedbacks } = setup()
	actions.pbus_recall.subscribe(action('a', { register: 0 }))
	assert.equal(text(feedbacks), 'PBUS 1\nRECALL 0')
	// Companion re-subscribes when a monitored option changes.
	actions.pbus_recall.subscribe(action('a', { pbus: 2, register: 12 }))
	assert.equal(text(feedbacks), 'PBUS 2\nRECALL 12')
})

test('trigger buttons show the trigger function, including trigger 0', () => {
	const { actions, feedbacks } = setup()
	actions.pbus_trigger.subscribe(action('a', { trigger: 4 }))
	assert.equal(text(feedbacks), 'PBUS 1\nSTOP')
	actions.pbus_trigger.subscribe(action('a', { trigger: 0 }))
	assert.equal(text(feedbacks), 'PBUS 1\nPLAY')
	actions.pbus_trigger.subscribe(action('a', { trigger: 9 }))
	assert.equal(text(feedbacks), 'PBUS 1\nLOOP EXIT')
})

test('label override wins; automatic label off leaves the button text alone', () => {
	const { actions, feedbacks } = setup()
	actions.pbus_recall.subscribe(action('a', { register: 3, labelOverride: 'VTR A' }))
	assert.equal(text(feedbacks), 'VTR A')
	assert.equal(text(feedbacks, false), undefined)
	assert.equal(
		feedbacks.pbus_button_state.callback({ controlId: 'other', options: { automaticLabel: true } }).text,
		undefined,
	)
})

test('PBUS monitors register, trigger and label for resubscribe', () => {
	const { actions } = setup()
	assert.ok(actions.pbus_recall.optionsToMonitorForSubscribe.includes('register'))
	assert.ok(actions.pbus_trigger.optionsToMonitorForSubscribe.includes('trigger'))
	for (const id of ['pbus_recall', 'pbus_trigger'])
		assert.ok(actions[id].options.some((option) => option.id === 'labelOverride'))
})

test('PBUS presets use the PBUS label feedback', () => {
	const ctx = setup()
	UpdatePresets(ctx.module)
	const pbus = Object.entries(ctx.presets).filter(([id]) => id.startsWith('pbus-'))
	assert.equal(pbus.length, 16)
	for (const [, preset] of pbus)
		assert.deepEqual(
			preset.feedbacks.map((f) => f.feedbackId),
			['pbus_button_state'],
		)
})

test('changing the mapped source updates the button-mapping text', () => {
	const { actions, feedbacks } = setup()
	const map = (options) => action('m', { bus: 'program', shift: 2, button: 1, source: 1, ...options }, 'map')
	const mapText = (automaticLabel = true) =>
		feedbacks.button_mapping_state.callback({ controlId: 'map', options: { automaticLabel } }).text
	actions.button_mapping.subscribe(map({}))
	assert.equal(mapText(), 'PGM MAP\nS2 B1→1')
	actions.button_mapping.subscribe(map({ bus: 'me3', source: 42 }))
	assert.equal(mapText(), 'ME3 MAP\nS2 B1→42')
	actions.button_mapping.subscribe(map({ labelOverride: 'CAM 4' }))
	assert.equal(mapText(), 'CAM 4')
	assert.equal(mapText(false), undefined)
	assert.ok(actions.button_mapping.optionsToMonitorForSubscribe.includes('source'))
})

test('button-mapping presets use the mapping label feedback', () => {
	const ctx = setup()
	UpdatePresets(ctx.module)
	const maps = Object.entries(ctx.presets).filter(([id]) => id.startsWith('button-map-'))
	assert.equal(maps.length, 60)
	for (const [, preset] of maps)
		assert.deepEqual(
			preset.feedbacks.map((f) => f.feedbackId),
			['button_mapping_state'],
		)
})

test('PBUS trigger is a 0-15 dropdown with the TDC-100B functions, including loops and banks', () => {
	const { actions } = setup()
	const option = actions.pbus_trigger.options.find((o) => o.id === 'trigger')
	assert.equal(option.type, 'dropdown')
	assert.deepEqual(
		option.choices.map((c) => c.id),
		Array.from({ length: 16 }, (_, i) => i),
	)
	const label = (n) => option.choices[n].label
	assert.equal(label(0), '0 — Normal Play')
	assert.equal(label(1), '1 — Recue')
	assert.equal(label(4), '4 — Stop')
	assert.match(label(8), /^8 — Multi-Point Loop Start/)
	assert.match(label(9), /^9 — Multi-Point Loop Exit/)
	assert.match(label(12), /^12 — Select Bank 2/)
	assert.equal(label(15), '15 — Normal Play')
	assert.equal(buildPbusTrigger(1, 15).length, 3)
	assert.throws(() => buildPbusTrigger(1, 16), /Trigger must be 0–15/)
})

test('image store output label shows the still the button loads, and tallies when the frame has it', () => {
	const { module, actions, feedbacks } = setup()
	const original = module.protocol.getImageStoreImage
	let live = 1
	module.protocol.getImageStoreImage = () => live
	try {
		actions.image_store.subscribe(action('is', { output: 9, image: 2 }, 'is'))
		const render = () =>
			feedbacks.image_store_button_state.callback({ controlId: 'is', options: { automaticLabel: true } })
		const svg = (result) => Buffer.from(result.png64, 'base64').toString()
		let result = render()
		assert.match(svg(result), /0002/)
		assert.doesNotMatch(svg(result), /0001/)
		assert.equal(result.bgcolor, 0x6a4c93)
		live = 2
		result = render()
		assert.match(svg(result), /0002/)
		assert.equal(result.bgcolor, 0xb9a3e3)
		actions.image_store.subscribe(action('is', { output: 9, image: 7 }, 'is'))
		assert.match(svg(render()), /0007/)
	} finally {
		module.protocol.getImageStoreImage = original
	}
})

test('image store input label follows the selected source', () => {
	const { actions, feedbacks } = setup()
	const render = () =>
		feedbacks.image_store_input_state.callback({ controlId: 'in', options: { automaticLabel: true } }).text
	actions.image_store_input.subscribe(action('in', { value: 1 }, 'in'))
	assert.equal(render(), 'IMAGE IN\n1')
	actions.image_store_input.subscribe(action('in', { value: 6 }, 'in'))
	assert.equal(render(), 'IMAGE IN\n6')
	actions.image_store_input.subscribe(action('in', { value: 6, labelOverride: 'CAM 6' }, 'in'))
	assert.equal(render(), 'IMAGE IN\nCAM 6')
	assert.ok(actions.image_store_input.optionsToMonitorForSubscribe.includes('value'))
})

test('macro stop, timeline run and timeline edit labels follow their options', () => {
	const { actions, feedbacks } = setup()
	const render = (id) => feedbacks.action_label.callback({ controlId: id, options: { automaticLabel: true } }).text
	actions.macro_stop.subscribe(action('s', { value: 1 }, 'stop'))
	assert.equal(render('stop'), 'STOP\nMACRO 1')
	actions.macro_stop.subscribe(action('s', { value: 23 }, 'stop'))
	assert.equal(render('stop'), 'STOP\nMACRO 23')
	actions.run.subscribe(action('r', { target: 'MASTER' }, 'run'))
	assert.equal(render('run'), 'MASTER\nRUN')
	actions.run.subscribe(action('r', { target: 'ME2-SEC' }, 'run'))
	assert.equal(render('run'), 'ME2 SEC\nRUN')
	actions.timeline_edit.subscribe(action('e', { target: 'MASTER', command: 'previous' }, 'edit'))
	assert.equal(render('edit'), 'PREVIOUS')
	actions.timeline_edit.subscribe(action('e', { target: 'ME1', command: 'go_end' }, 'edit'))
	assert.equal(render('edit'), 'ME1\nGO TO\nEND')
	actions.timeline_edit.subscribe(action('e', { target: 'ME1', command: 'mod', labelOverride: 'FIX KF' }, 'edit'))
	assert.equal(render('edit'), 'FIX KF')
	assert.deepEqual(feedbacks.action_label.callback({ controlId: 'edit', options: { automaticLabel: false } }), {})
	for (const id of ['macro_stop', 'run', 'timeline_edit'])
		assert.ok(actions[id].options.some((option) => option.id === 'labelOverride'))
})

test('every action with a choosable option tracks its button for labels', () => {
	const { actions } = setup()
	const unlabeled = Object.entries(actions)
		.filter(([, def]) => !def.subscribe || def.optionsToMonitorForSubscribe?.join() === 'suite,textSize,showSuite')
		.map(([id]) => id)
	// raw_cpl is free text the user labels; connect/stop-all have nothing to show.
	assert.deepEqual(unlabeled.sort(), ['connect', 'connection_toggle', 'disconnect', 'macro_stop_all', 'raw_cpl'])
})

test('timeline progress bar only shows on Run buttons aimed at the master timeline', () => {
	const { module, actions, feedbacks } = setup()
	const original = module.protocol.getTimelineState
	module.protocol.getTimelineState = () => ({ duration: 100, cursorTime: 50, pauseState: 0, pausePoints: [] })
	try {
		const render = () => feedbacks.timeline_progress.callback({ controlId: 'run', options: { suite: 'suite1a' } }).png64
		actions.run.subscribe(action('r', { target: 'MASTER' }, 'run'))
		const master = render()
		actions.run.subscribe(action('r', { target: 'ME1-PRI' }, 'run'))
		assert.notEqual(render(), master)
		assert.equal(render(), feedbacks.suite_badge.callback({ controlId: 'run', options: {} }).png64)
	} finally {
		module.protocol.getTimelineState = original
	}
})
