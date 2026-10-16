// Run after build: node --test test/repro-review-2026-0-9-5.mjs
// Repros for the blind-review findings fixed in 2026.0.9.5: reconnect gave up after
// maxRetries, one failing suite held every other suite's connect, and each heartbeat
// redrew every button. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { protocol } from '../dist/protocol.js'

const realSetTimeout = globalThis.setTimeout
const delay = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms))

function setup(config) {
	const module = new Module({ _isInstanceContext: true, id: 'review5' })
	const checks = []
	const variables = []
	const logs = []
	module.updateStatus = () => {}
	module.checkFeedbacks = (...ids) => checks.push(ids)
	module.setVariableValues = (values) => variables.push(values)
	module.log = (level, message) => logs.push([level, message])
	module.updateActions = () => {}
	module.updatePresets = () => {}
	module.config = config
	return { module, checks, variables, logs }
}

// Run module timers immediately while recording the delays they asked for.
function recordTimers() {
	const delays = []
	globalThis.setTimeout = (fn, ms, ...args) => {
		delays.push(ms)
		return realSetTimeout(fn, 0, ...args)
	}
	return { delays, restore: () => (globalThis.setTimeout = realSetTimeout) }
}

test('a failing suite does not hold back the next suite', async () => {
	const { module } = setup({ host: '192.0.2.10', suite1: true, suite2: true, maxRetries: 5 })
	const attempts = []
	module.connectSuite = async (id) => {
		attempts.push(id)
		return id === 'suite2a'
	}
	module.queueSelectedSuiteCascade()
	await delay(50)
	assert.deepEqual(attempts.slice(0, 2), ['suite1a', 'suite2a'])
	await module.destroy()
})

test('after the quick attempts it keeps retrying every 30 s instead of giving up', async () => {
	const { module, logs } = setup({ host: '192.0.2.10', suite1: true, maxRetries: 2 })
	let attempts = 0
	module.connectSuite = async () => (++attempts, false)
	const timers = recordTimers()
	try {
		module.queueSelectedSuiteCascade()
		while (attempts < 6) await delay(1)
	} finally {
		timers.restore()
		await module.destroy()
	}
	assert.deepEqual(timers.delays.slice(0, 5), [2000, 2000, 30000, 30000, 30000])
	const warnings = logs.filter(([, message]) => message.includes('maximum reconnection attempts reached'))
	assert.equal(warnings.length, 1, 'warning repeats on every slow retry')
})

test('a successful connect resets the quick attempts', async () => {
	const { module } = setup({ host: '192.0.2.10', suite1: true, maxRetries: 1 })
	let attempts = 0
	module.connectSuite = async () => ++attempts === 2
	const timers = recordTimers()
	try {
		module.queueSelectedSuiteCascade()
		while (attempts < 2) await delay(1)
		await delay(5)
		assert.equal(module.automaticAttempts.size, 0)
		assert.equal(module.automaticRetryTimers.size, 0)
	} finally {
		timers.restore()
		await module.destroy()
	}
})

test('manual Disconnect cancels a pending automatic retry', async () => {
	const { module } = setup({ host: '192.0.2.10', suite1: true, maxRetries: 5 })
	let attempts = 0
	module.connectSuite = async () => (++attempts, false)
	module.queueSelectedSuiteCascade()
	await delay(20)
	assert.equal(module.automaticRetryTimers.size, 1)
	await module.disconnectSuite('suite1a')
	assert.equal(module.automaticRetryTimers.size, 0)
	await delay(20)
	assert.equal(attempts, 1)
	await module.destroy()
})

test('a heartbeat redraws only the connection button', () => {
	const { module, checks, variables } = setup({ host: '192.0.2.10', suite1: true })
	module.suiteStates.suite1a.status = 'connected'
	module.updateRuntimeState()
	checks.length = 0
	variables.length = 0
	module.handleProtocolStatus(module.connectionId('suite1a'), 'HEARTBEAT_ACK', '')
	assert.deepEqual(checks, [['connection_state']])
	assert.equal(variables.length, 0)
	clearTimeout(module.suiteStates.suite1a.timer)
})

test('events that change no connection state do not redraw every button', () => {
	const { module, checks, variables } = setup({ host: '192.0.2.10', suite1: true })
	module.suiteStates.suite1a.status = 'connected'
	module.updateRuntimeState()
	checks.length = 0
	variables.length = 0
	for (const type of ['MACRO_SENT', 'AUX_ROUTE_SENT', 'WARNING'])
		module.handleProtocolStatus(module.connectionId('suite1a'), type, 'x')
	assert.deepEqual(checks, [])
	assert.equal(variables.length, 0)
})

test('a connection change still redraws every dependent button', () => {
	const { module, checks, variables } = setup({ host: '192.0.2.10', suite1: true })
	module.updateRuntimeState()
	checks.length = 0
	module.suiteStates.suite1a.status = 'connecting'
	module.updateRuntimeState()
	assert.equal(variables.at(-1).suite1_connection_status, 'connecting')
	assert.ok(checks.at(-1).includes('macro_button_state') && checks.at(-1).includes('connection_state'))
})

test('macro status changes still redraw macro buttons', () => {
	const { module, checks } = setup({ host: '192.0.2.10', suite1: true })
	module.handleProtocolStatus(module.connectionId('suite1a'), 'MACRO_STATUS_CHANGED', {
		origin: 'frame',
		macroStatus: { 3: 1 },
	})
	assert.ok(checks.some((ids) => ids.includes('macro_button_state') && ids.includes('macro_active')))
})

test('the macro flash timer redraws only while a macro is paused', async () => {
	const { module, checks } = setup({ host: '', suite1: false })
	module.updateFeedbacks = () => {}
	module.updateVariableDefinitions = () => {}
	let status = {}
	const saved = protocol.getMacroRunState
	protocol.getMacroRunState = () => ({ macroStatus: status, lastPlayedMacro: null, runSeq: 0 })
	try {
		await module.init({ host: '', suite1: false })
		checks.length = 0
		await delay(1100)
		assert.equal(checks.filter((ids) => ids.includes('macro_button_state')).length, 0, 'redraw with nothing paused')
		status = { 4: 7 }
		await delay(1100)
		assert.ok(checks.filter((ids) => ids.includes('macro_button_state')).length >= 2, 'paused macro did not flash')
	} finally {
		protocol.getMacroRunState = saved
		await module.destroy()
	}
})
