// Run after build: node --test test/repro-review-2026-0-9-6.mjs
// Macro buttons must redraw for macro changes Companion itself causes (Play, Stop,
// Stop All), not only for frame reports; failed macro sends must be logged. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'review6' })
	const checks = []
	const logs = []
	module.updateStatus = () => {}
	module.setVariableValues = () => {}
	module.checkFeedbacks = (...ids) => checks.push(ids)
	module.log = (level, message) => logs.push([level, message])
	module.config = { host: '192.0.2.10', suite1: true }
	return { module, checks, logs }
}

for (const origin of ['module', 'frame'])
	test(`a ${origin} macro status change redraws macro buttons`, () => {
		const { module, checks } = setup()
		module.handleProtocolStatus(module.connectionId('suite1a'), 'MACRO_STATUS_CHANGED', {
			origin,
			macroStatus: {},
			lastPlayedMacro: 5,
		})
		assert.ok(
			checks.some((ids) => ['macro_active', 'macro_button_state', 'action_label'].every((id) => ids.includes(id))),
		)
	})

test('a failed macro send is logged', () => {
	const { module, logs } = setup()
	module.handleProtocolStatus(module.connectionId('suite1a'), 'MACRO_ERROR', '5 EHOSTUNREACH')
	assert.ok(logs.some(([level, message]) => level === 'warn' && message.includes('5 EHOSTUNREACH')))
})

test('an incomplete macro catalog is logged', () => {
	const { module, logs } = setup()
	module.handleProtocolStatus(module.connectionId('suite1a'), 'MACRO_CATALOG_TIMEOUT', { attempts: 5 })
	assert.ok(logs.some(([level, message]) => level === 'warn' && message.includes('macro catalog')))
})
