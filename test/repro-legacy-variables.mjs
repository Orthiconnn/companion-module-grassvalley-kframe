// Run after build: node --test test/repro-legacy-variables.mjs
// grassvalley-kframe 1.0.0 published last_macro, last_aux and last_aux_source.
// Upgraded buttons and expressions read them, so the successor keeps them. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { UpdateVariableDefinitions } from '../dist/variables.js'
import { protocol } from '../dist/protocol.js'

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'legacy-vars' })
	module.checkFeedbacks = () => {}
	module.vars = {}
	module.setVariableValues = (values) => Object.assign(module.vars, values)
	let actions, definitions
	module.setActionDefinitions = (defs) => (actions = defs)
	module.setVariableDefinitions = (defs) => (definitions = defs)
	UpdateActions(module)
	UpdateVariableDefinitions(module)
	return { module, actions, definitions }
}
function patch(overrides) {
	const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, protocol[key]]))
	Object.assign(protocol, overrides)
	return () => Object.assign(protocol, saved)
}
const ok = () => ({ success: true, message: '' })
const fail = () => ({ success: false, message: 'not connected' })
const event = (options) => ({ options: { suite: 'suite1a', ...options } })

test('the three grassvalley-kframe variables are still defined', () => {
	const { definitions } = setup()
	for (const id of ['last_macro', 'last_aux', 'last_aux_source']) assert.ok(definitions[id], `${id} defined`)
})

test('a sent macro and AUX route update the legacy variables as numbers', async () => {
	const { module, actions } = setup()
	const restore = patch({ sendMacro: ok, sendAuxRoute: ok })
	try {
		await actions.macro_play.callback(event({ value: 25 }))
		await actions.aux_route.callback(event({ aux: 2, source: 740, transition: 'cut' }))
	} finally {
		restore()
	}
	assert.deepEqual(module.vars, { last_macro: 25, last_aux: 2, last_aux_source: 740 })
})

test('a failed send leaves the legacy variables unchanged', async () => {
	const { module, actions } = setup()
	const restore = patch({ sendMacro: fail, sendAuxRoute: fail })
	try {
		await assert.rejects(async () => actions.macro_play.callback(event({ value: 3 })))
		await assert.rejects(async () => actions.aux_route.callback(event({ aux: 1, source: 2, transition: 'cut' })))
	} finally {
		restore()
	}
	assert.deepEqual(module.vars, {})
})
