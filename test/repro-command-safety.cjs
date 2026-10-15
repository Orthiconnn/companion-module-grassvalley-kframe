// Run after build: node --test test/repro-command-safety.cjs
// Command-path safety: close races, Stop-All ordering, numeric validation.
// sendToFrame is replaced with a recorder; no packets leave the process.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function connected() {
	const instance = new HandshakeConnection(
		'safety',
		'127.0.0.1',
		'suite1a',
		{ mainPort: 0, listenerPort: 0 },
		null,
		'Safety',
		'0',
		'test',
	)
	instance.mainHandshakeStage = 9
	instance.protocol = 'udp'
	instance.macroSendDelayMs = 0
	const sent = []
	instance.sendToFrame = (buffer, callback) => {
		sent.push({ buffer, closing: instance.isClosing })
		if (callback) setImmediate(() => callback(null))
	}
	return { instance, sent }
}

test('timeline subscription sends nothing after disconnect between steps', async () => {
	const { instance, sent } = connected()
	instance.subscribeToMasterTimeline()
	// Four parameter requests go out 50 ms apart; disconnect right after the last.
	while (sent.length < 4) await delay(5)
	instance.cleanup()
	await delay(120)
	assert.deepEqual(sent.filter((entry) => entry.closing).length, 0, 'keyframe subscription sent on a closed connection')
	assert.equal(instance.timelineSubscribed, false)
})

test('Stop-All drops queued macros so none start afterward', async () => {
	const { instance, sent } = connected()
	const labels = new Map()
	const build = instance.createMacroPayload.bind(instance)
	instance.createMacroPayload = (macroNum, id, eid) => {
		const payload = build(macroNum, id, eid)
		labels.set(payload, `play ${macroNum}`)
		return payload
	}
	assert.equal(instance.sendMacro(1).success, true)
	assert.equal(instance.sendMacro(2).success, true)
	assert.equal(instance.sendMacroStopAll().success, true)
	await delay(50)
	const order = sent.map((entry) => labels.get(entry.buffer) ?? 'stop all')
	assert.deepEqual(order, ['play 1', 'stop all'])
	instance.cleanup()
})

const invalid = [NaN, Infinity, 1.5, '3', null, undefined]
const cases = {
	sendMacro: (v) => [v],
	sendMacroStop: (v) => [v],
	'sendAuxRoute aux': (v) => [v, 1],
	'sendAuxRoute source': (v) => [1, v],
	'sendImageStore output': (v) => [v, 1],
	'sendImageStore image': (v) => [1, v],
	sendImageStoreInput: (v) => [v],
	sendEMem: (v) => [v],
	sendPanelMem: (v) => [v],
	'sendEMemTargeted emem': (v) => [v, 0x01000000, 0],
	'sendEMemTargeted mode': (v) => [1, 0x01000000, v],
	'sendEMemTargeted did': (v) => [1, v, 0],
	'sendCrosspoint did': (v) => [0x104a, v, 1],
	'sendTransitionEvent did': (v) => [0x0043, v],
}
for (const [name, args] of Object.entries(cases)) {
	test(`${name} rejects non-integer input without sending`, async () => {
		const method = name.split(' ')[0]
		const { instance, sent } = connected()
		for (const value of invalid) {
			const result = instance[method](...args(value))
			assert.equal(result.success, false, `${method}(${String(value)}) accepted`)
		}
		await delay(10)
		assert.equal(sent.length, 0)
		instance.cleanup()
	})
}

test('valid whole-number commands are still accepted', async () => {
	const { instance, sent } = connected()
	assert.equal(instance.sendMacro(5).success, true)
	assert.equal(instance.sendAuxRoute(1, 10).success, true)
	assert.equal(instance.sendEMem(0).success, true)
	assert.equal(instance.sendCrosspoint(0x104a, 0x01000000, 10).success, true)
	assert.equal(instance.sendTransitionEvent(0x0043, 0x01000000).success, true)
	await delay(20)
	assert.ok(sent.length >= 5)
	instance.cleanup()
})

test('UDP sendToFrame on a closed socket reports an error instead of throwing', async () => {
	const dgram = require('node:dgram')
	const instance = new HandshakeConnection(
		'safety',
		'127.0.0.1',
		'suite1a',
		{ mainPort: 0, listenerPort: 0 },
		null,
		'Safety',
		'0',
		'test',
	)
	const socket = dgram.createSocket('udp4')
	await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
	instance.protocol = 'udp'
	instance.mainClient = socket
	instance.secondPhaseDynamicCommPort = socket.address().port
	socket.close()
	for (const closing of [false, true]) {
		instance.isClosing = closing
		const errors = []
		assert.doesNotThrow(() => instance.sendToFrame(Buffer.alloc(4), (err) => errors.push(err)))
		assert.equal(errors.length, 1, `isClosing=${closing}: callback must receive the error`)
		assert.ok(errors[0] instanceof Error)
		assert.doesNotThrow(() => instance.sendToFrame(Buffer.alloc(4)), `isClosing=${closing}: no-callback send threw`)
	}
	instance.mainClient = null
})
