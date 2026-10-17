// Run after build: node --test test/repro-review-2026-0-9-9.mjs
// Fourth blind review: an unknown transition type fired an AUTO transition (and an
// unknown AUX transition became a cut); a manual Connect could outlive a config
// save. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { protocol } from '../dist/protocol.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'review9' })
	module.updateStatus = () => {}
	module.setVariableValues = () => {}
	module.checkFeedbacks = () => {}
	module.log = () => {}
	module.updateActions = () => {}
	module.updatePresets = () => {}
	module.config = { host: '192.0.2.10', suite1: true, maxRetries: 0 }
	let actions
	module.setActionDefinitions = (defs) => (actions = defs)
	UpdateActions(module)
	return { module, actions }
}
function patch(object, overrides) {
	const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]))
	Object.assign(object, overrides)
	return () => Object.assign(object, saved)
}
const event = (options) => ({ options: { suite: 'suite1a', ...options } })

test('an unknown transition type is rejected instead of firing AUTO', async () => {
	const { actions } = setup()
	const sent = []
	const restore = patch(protocol, {
		sendTransitionEvent: (_id, eid, did) => (sent.push([eid, did]), { success: true, message: '' }),
	})
	try {
		for (const transition of ['Cut', 'mix', '', 'undefined'])
			assert.throws(() => actions.transition.callback(event({ target: 'PGM_PRI', transition })), /Invalid transition/)
		assert.deepEqual(sent, [])
		actions.transition.callback(event({ target: 'PGM_PRI', transition: 'cut' }))
		actions.transition.callback(event({ target: 'PGM_PRI', transition: 'auto' }))
		assert.deepEqual(
			sent.map(([eid]) => eid),
			[0x44, 0x43],
		)
	} finally {
		restore()
	}
})

test('an unknown AUX transition is rejected instead of sending a cut', async () => {
	const { createRequire } = await import('node:module')
	const HandshakeConnection = createRequire(import.meta.url)('../dist/protocol/handshake-connection-class.cjs')
	const connection = new HandshakeConnection('aux', '127.0.0.1', 'suite1a', {}, 'Aux', '0', 'test')
	connection.mainHandshakeStage = 9
	connection.fullyConnected = true
	const sent = []
	connection.sendToFrame = (packet, callback) => (sent.push(packet), callback?.(null))
	assert.equal(connection.sendAuxRoute(1, 10, 'auto').success, false)
	assert.equal(connection.sendAuxRoute(1, 10, 'Cut').success, false)
	assert.equal(sent.length, 0)
	for (const transition of ['cut', 'mix', 'wipe'])
		assert.equal(connection.sendAuxRoute(1, 10, transition).success, true)
	assert.equal(sent.length, 3)
})

test('a config save during a manual Connect closes that stale connection', async () => {
	const { module } = setup()
	const closed = []
	const restore = patch(protocol, {
		createConnection: async () => {
			await delay(30)
			return () => {}
		},
		disconnectConnection: async (id) => {
			closed.push(id)
		},
	})
	try {
		const started = Date.now()
		const connecting = module.connectSuite('suite1a')
		await delay(5)
		module.connectionConfigGeneration++ // as configUpdated() does
		assert.equal(await connecting, false)
		// Closed as soon as the connection registers, not after the 20 s connect timeout.
		assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`)
		assert.ok(closed.includes(module.connectionId('suite1a')))
		assert.equal(module.suiteStates.suite1a.status, 'disconnected')
	} finally {
		restore()
		await module.destroy()
	}
})
