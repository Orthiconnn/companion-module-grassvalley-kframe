import assert from 'node:assert/strict'
import { UpgradeScripts } from '../dist/upgrades.js'

const value = (input) => ({ value: input, isExpression: false })
const action = (id, actionId, options) => ({ id, controlId: `bank:${id}`, actionId, options })
const feedback = (id, feedbackId, options) => ({ id, controlId: `bank:${id}`, feedbackId, options })

function runUpgrade({ config, actions = [], feedbacks = [] }) {
	return UpgradeScripts[0]({ currentConfig: config }, { config, secrets: null, actions, feedbacks })
}

function runSuiteDotUpgrade({ config, actions = [], feedbacks = [] }) {
	return UpgradeScripts[1]({ currentConfig: config }, { config, secrets: null, actions, feedbacks })
}

const macro = action('macro', 'macro_recall', { macroNum: value('42') })
const auxList = action('aux-list', 'aux_route', {
	auxNum: value('3'),
	sourceMode: value('list'),
	sourceNum: value(117),
})
const auxVariable = action('aux-variable', 'aux_route', {
	auxNum: value('$(custom:aux_bus)'),
	sourceMode: value('variable'),
	sourceVar: value('$(custom:source)'),
})
const macroFeedback = feedback('macro', 'macro_sent', { macroNum: value(42) })
const auxFeedback = feedback('aux-list', 'aux_sent', { auxNum: value(3) })

const result = runUpgrade({
	config: { host: '192.0.2.10', suite: 'suite3b', keepaliveInterval: 2000, maxRetries: 5 },
	actions: [macro, auxList, auxVariable],
	feedbacks: [macroFeedback, auxFeedback],
})

assert.deepEqual(result.updatedConfig, {
	host: '192.0.2.10',
	suite1: false,
	suite2: false,
	suite3: true,
	suite4: false,
	maxRetries: 5,
	_legacySuite: 'suite3b',
})
assert.equal(result.updatedActions.length, 3)
assert.equal(result.updatedFeedbacks.length, 2)

assert.equal(macro.actionId, 'macro_play')
assert.deepEqual(macro.options, {
	suite: value('suite3a'),
	value: value(42),
	labelOverride: value(''),
	textSize: value(100),
	showSuite: value(true),
})

assert.deepEqual(auxList.options, {
	suite: value('suite3a'),
	aux: value(3),
	source: value(117),
	transition: value('cut'),
	labelOverride: value(''),
	textSize: value(100),
	showSuite: value(true),
})

assert.deepEqual(auxVariable.options.aux, { value: '$(custom:aux_bus)', isExpression: true })
assert.deepEqual(auxVariable.options.source, { value: '$(custom:source)', isExpression: true })
assert.equal(auxVariable.options.suite.value, 'suite3a')

assert.equal(macroFeedback.feedbackId, 'macro_button_state')
assert.deepEqual(macroFeedback.options, { automaticLabel: value(true) })
assert.equal(auxFeedback.feedbackId, 'aux_button_state')
assert.deepEqual(auxFeedback.options, { automaticLabel: value(true) })

const existingAction = action('existing', 'transition', { suite: value('suite4a'), showSuite: undefined })
const hiddenAction = action('hidden', 'macro_play', { suite: value('suite2a'), showSuite: value(false) })
const suiteDotResult = runSuiteDotUpgrade({ config: result.updatedConfig, actions: [existingAction, hiddenAction] })
assert.equal(suiteDotResult.updatedActions.length, 1)
assert.deepEqual(existingAction.options.showSuite, value(true))
assert.deepEqual(hiddenAction.options.showSuite, value(false))

// A second run must be a no-op: published upgrade scripts should be idempotent.
const second = runUpgrade({
	config: result.updatedConfig,
	actions: [macro, auxList, auxVariable],
	feedbacks: [macroFeedback, auxFeedback],
})
assert.equal(second.updatedConfig, null)
assert.deepEqual(second.updatedActions, [])
assert.deepEqual(second.updatedFeedbacks, [])

// Companion may upgrade the connection config before it supplies the controls.
// The hidden legacy suite must survive that split pass.
const splitMacro = action('split-macro', 'macro_recall', { macroNum: value(9) })
const splitResult = UpgradeScripts[0](
	{ currentConfig: result.updatedConfig },
	{ config: null, secrets: null, actions: [splitMacro], feedbacks: [] },
)
assert.equal(splitMacro.options.suite.value, 'suite3a')
assert.equal(splitResult.updatedActions.length, 1)

console.log('Legacy K-Frame config, Macro/AUX actions, feedbacks, expressions, and idempotency passed')
