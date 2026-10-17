// Run after build: node --test test/repro-review-2026-0-9-7.mjs
// Third blind review: saving the config while a suite was still connecting left the
// old queue entry in place, so the new connect was dropped and the suite stayed
// disconnected. A failed queue step must not stop the suites behind it. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { protocol } from '../dist/protocol.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(config) {
	const module = new Module({ _isInstanceContext: true, id: 'review7' })
	const checks = []
	module.updateStatus = () => {}
	module.setVariableValues = () => {}
	module.checkFeedbacks = (...ids) => checks.push(ids)
	module.log = () => {}
	module.updateActions = () => {}
	module.updatePresets = () => {}
	module.config = config
	return { module, checks }
}

test('a config save during a connect still connects with the new config', async () => {
	const config = { host: '192.0.2.10', suite1: true, suite2: true, maxRetries: 5 }
	const { module } = setup(config)
	const attempts = []
	let releaseFirst
	module.connectSuite = (id, _automatic, generation) => {
		attempts.push([id, generation])
		// The first attempt hangs like a handshake to a silent frame.
		if (attempts.length === 1) return new Promise((resolve) => (releaseFirst = () => resolve(false)))
		return Promise.resolve(true)
	}
	const saved = protocol.disconnectConnection
	protocol.disconnectConnection = async () => {}
	try {
		module.queueSelectedSuiteCascade()
		await delay(10)
		const saving = module.configUpdated({ ...config, host: '192.0.2.11' })
		await delay(10)
		releaseFirst()
		await saving
		await delay(50)
		const generation = module.connectionConfigGeneration
		const current = attempts.filter(([, g]) => g === generation).map(([id]) => id)
		assert.deepEqual(current.sort(), ['suite1a', 'suite2a'])
	} finally {
		protocol.disconnectConnection = saved
		await module.destroy()
	}
})

test('a failed queue step does not stop the suites behind it', async () => {
	const { module } = setup({ host: '192.0.2.10', suite1: true, suite2: true, maxRetries: 5 })
	const attempts = []
	module.connectAutomatically = async (id) => {
		attempts.push(id)
		if (id === 'suite1a') throw new Error('boom')
	}
	module.queueSelectedSuiteCascade()
	await delay(20)
	assert.deepEqual(attempts, ['suite1a', 'suite2a'])
	await module.destroy()
})

test('changing a Connect button text size redraws its connection face', () => {
	const { module, checks } = setup({ host: '', suite1: true })
	module.trackSuiteButton('btn', 'a1', { suite: 'suite1a', textSize: 2, showSuite: true })
	assert.ok(checks.some((ids) => ids.includes('connection_state') && ids.includes('timeline_progress')))
})
