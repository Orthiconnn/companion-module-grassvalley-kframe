// Run after build: node --test test/repro-protocol-round3.cjs
// Protocol-layer regressions from the third review round. Loopback only.
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const { test } = require('node:test')
const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const H = Buffer.from([0xb9, 0x91, 0x6f, 0x84])

function connection() {
	return new HandshakeConnection('round3', '127.0.0.1', 'suite1a', {}, null, 'Round3', '0', 'test')
}

async function bound() {
	const socket = dgram.createSocket('udp4')
	await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve))
	return socket
}

test('UDP suite command second send is skipped after cleanup (no uncaught socket error)', async () => {
	const uncaught = []
	const onUncaught = (error) => uncaught.push(error)
	process.on('uncaughtException', onUncaught)
	const sink = await bound()
	const instance = connection()
	try {
		instance.mainClient = await bound()
		instance.listenerClient = await bound()
		instance.protocol = 'udp'
		instance.secondPhaseDynamicCommPort = sink.address().port
		instance.sendSuiteCommand()
		await delay(30)
		instance.cleanup()
		await delay(150)
		assert.deepEqual(
			uncaught.map((error) => error.code),
			[],
		)
	} finally {
		process.off('uncaughtException', onUncaught)
		instance.cleanup()
		sink.close()
	}
})

test('concurrent createConnection for one id leaves no orphaned live connection', async () => {
	const manager = require('../dist/protocol/connection-manager.cjs')
	const original = HandshakeConnection.prototype.start
	const started = []
	HandshakeConnection.prototype.start = async function () {
		started.push(this)
		return () => this.cleanup()
	}
	try {
		await manager.createConnection('round3', 'old', 'suite1a', {}, 'S', '0', 't')
		const dead = manager.getConnection('round3')
		dead.mainClient = dgram.createSocket('udp4')
		dead.listenerClient = dgram.createSocket('udp4')
		dead.cleanup() // heartbeat timeout: cleaned up, still in the map
		await delay(20)
		const first = manager.createConnection('round3', 'host-A', 'suite1a', {}, 'S', '0', 't')
		await delay(10)
		const second = manager.createConnection('round3', 'host-B', 'suite1a', {}, 'S', '0', 't')
		await Promise.all([first, second])
		const live = started.slice(1).filter((c) => !c.isClosing)
		assert.deepEqual(
			live.map((c) => c.targetHost),
			['host-B'],
			'exactly the latest request stays live',
		)
		assert.equal(manager.getConnection('round3')?.targetHost, 'host-B')
	} finally {
		await manager.disconnectConnection('round3')
		HandshakeConnection.prototype.start = original
	}
	assert.ok(
		started.every((c) => c.isClosing),
		'every connection is closed after disconnect',
	)
})

test('short AUX and ME responses do not read into the next packed response', () => {
	const instance = connection()
	const events = []
	instance.emitter.on('auxStateChanged', (data) => events.push(['aux', data]))
	instance.emitter.on('meStateChanged', (data) => events.push(['me', data]))
	const response = (payload) => {
		const header = Buffer.alloc(12)
		header.writeUInt16BE(0x0002, 0)
		header.writeUInt16BE(0x0010, 2)
		header.writeUInt32BE(payload.length, 4)
		return Buffer.concat([header, payload])
	}
	for (const marker of [0x19, 0x04]) {
		const short = Buffer.alloc(18)
		short.writeUInt16BE(0x0400, 0)
		short.writeUInt16BE(0x104a, 8)
		short[12] = marker
		short[15] = 3
		const other = Buffer.alloc(16)
		other.writeUInt16BE(0x0999, 0)
		instance.handleSubscriptionData(Buffer.concat([Buffer.from([0, 4, 0, 1]), response(short), response(other)]))
	}
	assert.deepEqual(events, [])
})

test('a stray TCP header with a large length does not hold back valid frames', () => {
	const instance = connection()
	const good = instance.tcpWrap(Buffer.from('0002001000000004000000000000aaaa', 'hex'))
	const { frames, remaining } = instance.tcpUnwrap(
		Buffer.concat([H, Buffer.from([0xff, 0xff]), Buffer.alloc(10), good]),
	)
	assert.equal(frames.length, 1)
	assert.deepEqual(frames[0], good.subarray(6, good.length - 4))
	assert.equal(remaining.length, 0)
})

test('headerless TCP data is discarded instead of growing the buffer', () => {
	const instance = connection()
	let buffer = Buffer.alloc(0)
	for (let i = 0; i < 1000; i++)
		buffer = instance.tcpUnwrap(Buffer.concat([buffer, Buffer.alloc(1024, 0x11)])).remaining
	assert.ok(buffer.length < H.length, `buffer kept ${buffer.length} bytes`)
})

test('TCP frames split across chunks and split headers still reassemble', () => {
	const instance = connection()
	const a = instance.tcpWrap(Buffer.from('aa'.repeat(40), 'hex'))
	const b = instance.tcpWrap(Buffer.from('bb'.repeat(20), 'hex'))
	const stream = Buffer.concat([Buffer.from([0x00, 0x01]), a, b])
	const frames = []
	let buffer = Buffer.alloc(0)
	for (let i = 0; i < stream.length; i += 3) {
		const result = instance.tcpUnwrap(Buffer.concat([buffer, stream.subarray(i, i + 3)]))
		frames.push(...result.frames)
		buffer = result.remaining
	}
	assert.deepEqual(
		frames.map((frame) => frame.toString('hex')),
		['aa'.repeat(40), 'bb'.repeat(20)],
	)
	assert.equal(buffer.length, 0)
})
