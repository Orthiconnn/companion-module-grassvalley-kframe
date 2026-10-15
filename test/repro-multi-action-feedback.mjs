// Run after build: node --test test/repro-multi-action-feedback.mjs
// Real subscription callbacks, no module init, sockets, or commands.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { UpdateFeedbacks } from '../dist/feedbacks.js'
const types = {
	macro_play: ['macroButtons', { value: 1 }],
	aux_route: ['auxButtons', { aux: 1, source: 10, transition: 'cut' }],
	crosspoint: ['crosspointButtons', { target: 'ME1_A', source: 10 }],
	emem: ['ememButtons', { target: 'MASTER', register: 0 }],
	transition: ['transitionButtons', { target: 'ME1_PRI', transition: 'auto' }],
	panel_memory: ['panelMemoryButtons', { value: 1 }],
	image_store: ['imageStoreButtons', { output: 1, image: 1 }],
	gpi: ['gpiButtons', { value: 1 }],
}
function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'subscription-review' })
	module.checkFeedbacks = () => {}
	let actions, feedbacks
	module.setActionDefinitions = (defs) => {
		actions = defs
	}
	module.setFeedbackDefinitions = (defs) => {
		feedbacks = defs
	}
	UpdateActions(module)
	UpdateFeedbacks(module)
	return { module, actions, feedbacks }
}
function action(id, options, controlId = 'button') {
	return { id, controlId, options: { suite: 'suite1a', textSize: 100, showSuite: true, ...options } }
}
for (const [type, [map, options]] of Object.entries(types)) {
	for (const remove of ['first', 'second']) {
		test(`${type}: removing ${remove} preserves the other action and its suite badge`, () => {
			const { module, actions } = setup()
			const first = action('first', { ...options, labelOverride: 'First', suite: 'suite1a', showSuite: false })
			const second = action('second', { ...options, labelOverride: 'Second', suite: 'suite2a', showSuite: true })
			actions[type].subscribe(first)
			actions[type].subscribe(second)
			actions[type].unsubscribe(remove === 'first' ? first : second)
			const remaining = remove === 'first' ? second : first
			assert.equal(module[map].get('button')?.labelOverride, remaining.options.labelOverride)
			assert.equal(module[map].get('button')?.suite, remaining.options.suite)
			assert.equal(module[map].get('button')?.showSuite !== false, remaining.options.showSuite)
			assert.equal(module.suiteButtons.get('button')?.size, 1)
			actions[type].unsubscribe(remaining)
			assert.equal(module[map].has('button'), false)
			assert.equal(module.suiteButtons.has('button'), false)
		})
	}
}

test('Macro feedback still renders the remaining action after another is removed', () => {
	const { module, actions, feedbacks } = setup()
	const first = action('first', { value: 1, labelOverride: 'First' })
	const second = action('second', { value: 2, labelOverride: 'Second' })
	actions.macro_play.subscribe(first)
	actions.macro_play.subscribe(second)
	actions.macro_play.unsubscribe(first)
	const result = feedbacks.macro_button_state.callback({ controlId: 'button', options: { automaticLabel: true } })
	assert.equal(result.text, 'Second')
})

test('Updating or subscribing an action twice does not leave stale assignments', () => {
	const { module, actions } = setup()
	const first = action('first', { value: 1, labelOverride: 'Original' })
	const second = action('second', { value: 2, labelOverride: 'Second' })
	actions.macro_play.subscribe(first)
	actions.macro_play.subscribe(second)
	actions.macro_play.unsubscribe(first)
	first.options = { ...first.options, value: 3, labelOverride: 'Updated', showSuite: false }
	actions.macro_play.subscribe(first)
	actions.macro_play.subscribe(first)
	assert.equal(module.macroButtons.get('button').macro, 3)
	assert.equal(module.suiteButtons.get('button').size, 2)
	actions.macro_play.unsubscribe(second)
	assert.equal(module.macroButtons.get('button').labelOverride, 'Updated')
	assert.equal(module.macroButtons.get('button')?.showSuite !== false, false)
	actions.macro_play.unsubscribe(first)
	assert.equal(module.macroButtons.has('button'), false)
	assert.equal(module.suiteButtons.has('button'), false)
})

test('Action removal is isolated across buttons and action types', () => {
	const { module, actions } = setup()
	const macro = action('shared-id', { value: 1, labelOverride: 'Macro' }, 'button-a')
	const other = action('shared-id', { value: 2, labelOverride: 'Other button' }, 'button-b')
	const aux = action('aux', { aux: 1, source: 10, labelOverride: 'Aux' }, 'button-a')
	actions.macro_play.subscribe(macro)
	actions.macro_play.subscribe(other)
	actions.aux_route.subscribe(aux)
	actions.macro_play.unsubscribe(action('missing', { value: 3 }, 'button-a'))
	assert.equal(module.macroButtons.get('button-a').labelOverride, 'Macro')
	actions.macro_play.unsubscribe(macro)
	assert.equal(module.macroButtons.has('button-a'), false)
	assert.equal(module.macroButtons.get('button-b').labelOverride, 'Other button')
	assert.equal(module.auxButtons.get('button-a').labelOverride, 'Aux')
	assert.equal(module.suiteButtons.get('button-a').size, 1)
})

test('Suite badge includes every action instance and recovers after one is removed', () => {
	const { module, actions, feedbacks } = setup()
	const first = action('first', { value: 1, suite: 'suite1a' })
	const second = action('second', { value: 2, suite: 'suite2a' })
	const badge = () => feedbacks.suite_badge.callback({ controlId: 'button', options: {} })
	const empty = badge()
	actions.macro_play.subscribe(first)
	const suite1 = badge()
	actions.macro_play.subscribe(second)
	assert.equal(module.suiteButtons.get('button').size, 2)
	assert.equal(badge().png64, empty.png64, 'Mixed suites must not show a misleading single-suite badge')
	actions.macro_play.unsubscribe(second)
	assert.deepEqual(badge(), suite1)
})
