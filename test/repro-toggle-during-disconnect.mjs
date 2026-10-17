// Run after build: node --test test/repro-toggle-during-disconnect.mjs
// The protocol announces DISCONNECTED before disconnectConnection() resolves, so a
// second Connect / Disconnect press can land while the close is still running.
// Pressing twice must end connected, and Connect right after Disconnect must stick. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { protocol } from '../dist/protocol.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function patch(object, overrides) {
	const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]))
	Object.assign(object, overrides)
	return () => Object.assign(object, saved)
}

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'toggle' })
	module.checkFeedbacks = () => {}
	module.setVariableValues = () => {}
	module.updateStatus = () => {}
	module.log = () => {}
	module.config = { host: '127.0.0.1', suite1: true, maxRetries: 0 }
	let actions
	module.setActionDefinitions = (defs) => (actions = defs)
	UpdateActions(module)
	// Source-name refreshes rebuild definitions; this test only watches connection state.
	module.updateActions = () => {}
	module.updatePresets = () => {}
	const created = []
	const restore = patch(protocol, {
		// Like the real manager: the close is announced first, cleanup finishes later.
		disconnectConnection: async (id) => {
			module.handleProtocolStatus(id, 'DISCONNECTED', 'closed')
			await delay(50)
		},
		createConnection: async (id) => {
			created.push(id)
			setTimeout(() => module.handleProtocolStatus(id, 'CONNECTED', ''), 10)
		},
		getConnectionInfo: () => ({ frameVersion: 'V14.7.1', protocol: 'udp' }),
		subscribeToSourceNames: () => {},
	})
	module.suiteStates.suite1a.status = 'connected'
	const press = (id) => actions[id].callback({ options: { suite: 'suite1a' } })
	return { module, press, created, restore }
}

test('two quick Connect / Disconnect presses end connected', async () => {
	const { module, press, created, restore } = setup()
	try {
		const off = press('connection_toggle')
		await delay(0)
		assert.equal(module.suiteStates.suite1a.status, 'disconnected')
		await press('connection_toggle')
		await off
		await delay(150)
		assert.equal(module.suiteStates.suite1a.status, 'connected')
		assert.equal(created.length, 1)
	} finally {
		restore()
	}
})

test('Connect pressed while Disconnect is still closing ends connected', async () => {
	const { module, press, created, restore } = setup()
	try {
		const off = press('disconnect')
		await delay(0)
		await press('connect')
		await off
		await delay(150)
		assert.equal(module.suiteStates.suite1a.status, 'connected')
		assert.equal(created.length, 1)
		assert.equal(module.manuallyDisconnectedSuites.has('suite1a'), false)
	} finally {
		restore()
	}
})

test('Disconnect pressed twice while closing stays disconnected', async () => {
	const { module, press, created, restore } = setup()
	try {
		const first = press('disconnect')
		await delay(0)
		await press('disconnect')
		await first
		await delay(150)
		assert.equal(module.suiteStates.suite1a.status, 'disconnected')
		assert.equal(created.length, 0)
	} finally {
		restore()
	}
})
