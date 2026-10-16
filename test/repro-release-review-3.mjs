// Run after build: node --test test/repro-release-review-3.mjs
// Seventh review: on TCP a command sent between handshake and CONNECTED reached the
// frame before the suite select; republishing action definitions reset the PBUS
// queue so two presses could interleave again. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { protocol } from '../dist/protocol.js'

const HandshakeConnection = createRequire(import.meta.url)('../dist/protocol/handshake-connection-class.cjs')

test('operator commands wait for CONNECTED, not just the end of the handshake', () => {
	const connection = new HandshakeConnection('ready', '127.0.0.1', 'suite1a', {}, 'Ready', '0', 't')
	const sent = []
	connection.sendToFrame = (packet, callback) => (sent.push(packet), callback?.(null))
	connection.mainHandshakeStage = 9 // handshake done, suite not yet selected
	const commands = [
		() => connection.sendMacro(5),
		() => connection.sendMacroStop(5),
		() => connection.sendMacroStopAll(),
		() => connection.sendAuxRoute(1, 10, 'cut'),
		() => connection.sendImageStore(1, 1),
		() => connection.sendImageStoreInput(1),
		() => connection.sendEMem(1),
		() => connection.sendRawCommand('0004000100020005000000080000000f0002000035000001'),
		() => connection.sendPanelMem(1),
		() => connection.sendCrosspoint(0x104a, 0x04000003, 1),
		() => connection.sendTransitionEvent(0x44, 0x03000003),
		() => connection.sendTimelineEvent(2, 0x35000001, []),
		() => connection.sendEMemTargeted(1, 0x02000000, 0),
	]
	for (const command of commands) assert.equal(command().success, false)
	assert.equal(sent.length, 0)
	connection.fullyConnected = true // CONNECTED, suite selected
	for (const command of commands) assert.equal(command().success, true)
})

test('republishing actions mid-sequence does not let PBUS presses interleave', async () => {
	const module = new Module({ _isInstanceContext: true, id: 'pbusq' })
	Object.assign(module, { updateStatus() {}, setVariableValues() {}, checkFeedbacks() {}, log() {} })
	module.config = { host: '192.0.2.10', suite1: true }
	let actions
	module.setActionDefinitions = (defs) => (actions = defs)
	UpdateActions(module)
	const frames = []
	const saved = protocol.sendRawCommand
	protocol.sendRawCommand = (_id, command) => (frames.push(command.slice(8)), { success: true, message: '' })
	try {
		const play = actions.pbus_trigger.callback({ options: { suite: 'suite1a', pbus: 1, trigger: 0 } })
		await new Promise((resolve) => setTimeout(resolve, 20))
		UpdateActions(module) // e.g. another suite's source names arrive
		const stop = actions.pbus_trigger.callback({ options: { suite: 'suite1a', pbus: 1, trigger: 1 } })
		await Promise.all([play, stop])
		assert.equal(frames.length, 8)
		assert.equal(frames[3], frames[0], 'first sequence finished before the second started')
	} finally {
		protocol.sendRawCommand = saved
	}
})
