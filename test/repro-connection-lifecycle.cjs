// Run: npm run build && node --test test/repro-connection-lifecycle.cjs
// Regression coverage for startup failures and cancellation at async boundaries.
// All packets stay on loopback; no switcher or fixed service ports are used.
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const { test } = require('node:test')
const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function loopbackSocket() {
	const socket = dgram.createSocket('udp4')
	await new Promise((resolve, reject) => {
		socket.once('error', reject)
		socket.bind(0, '127.0.0.1', resolve)
	})
	return socket
}

function connection() {
	const instance = new HandshakeConnection(
		'review',
		'127.0.0.1',
		'suite1a',
		{ mainPort: 0, listenerPort: 0 },
		'Review',
		'0',
		'test',
	)
	// Explicitly use OS-assigned ports even if constructor defaults change.
	instance.mainClientPort = 0
	instance.listenerClientPort = 0
	return instance
}

function close(socket) {
	try {
		socket?.close()
	} catch {
		/* Already closed or never bound. */
	}
}

function dispose(instance) {
	instance.cleanup()
	// Fallback teardown keeps a regression from leaking sockets into later tests.
	clearInterval(instance.packet1RetryIntervalId)
	clearTimeout(instance.handshakeOverallTimeoutId)
	close(instance.mainClient)
	close(instance.listenerClient)
}

function boundPort(socket) {
	try {
		return socket?.address().port ?? null
	} catch {
		return null
	}
}

test('UDP bind failure must reject startup instead of leaving it pending', async (t) => {
	const blocker = await loopbackSocket()
	const instance = connection()
	instance.mainClientPort = blocker.address().port
	const errors = []
	instance.emitter.on('status', (type, message) => {
		if (type === 'ERROR') errors.push(message)
	})
	try {
		const outcome = await Promise.race([
			instance.startUdp().then(
				() => 'resolved',
				() => 'rejected',
			),
			delay(300).then(() => 'pending'),
		])
		t.diagnostic(`Socket errors: ${errors.join('; ')}`)
		t.diagnostic(`Startup promise after bind error: ${outcome}`)
		assert.ok(
			errors.some((message) => message.includes('EADDRINUSE')),
			'Must reproduce a real bind conflict',
		)
		assert.equal(outcome, 'rejected', 'Bind failure must settle startup so retries and later suites can proceed')
	} finally {
		dispose(instance)
		close(blocker)
	}
})

test('Cancelling during TCP detection must not open UDP sockets afterward', async (t) => {
	const sink = await loopbackSocket()
	const instance = connection()
	instance.initialServerPort = sink.address().port
	let failDetection
	let detectionStarted
	const started = new Promise((resolve) => {
		detectionStarted = resolve
	})
	// Control only TCP detection timing. UDP startup and cleanup are real code.
	instance.tryTcpConnect = () =>
		new Promise((resolve, reject) => {
			failDetection = reject
			detectionStarted()
		})
	try {
		const pending = instance.start().then(
			() => 'resolved',
			() => 'rejected',
		)
		await started
		instance.cleanup()
		failDetection(new Error('Simulated TCP detection timeout after cancellation'))
		const outcome = await Promise.race([pending, delay(300).then(() => 'pending')])
		instance.cleanup()
		const ports = { main: boundPort(instance.mainClient), listener: boundPort(instance.listenerClient) }
		t.diagnostic(
			`Startup: ${outcome}; isClosing: ${instance.isClosing}; still-bound UDP ports: ${JSON.stringify(ports)}`,
		)
		assert.deepEqual(ports, { main: null, listener: null }, 'Cancelled startup must leave no UDP sockets bound')
	} finally {
		dispose(instance)
		close(sink)
	}
})

// Real sockets: cancelling while detection/binding is pending must settle startup.
test('TCP detection cancellation closes its socket and settles promptly', async () => {
	const instance = connection()
	const pending = instance.tryTcpConnect().then(
		() => 'resolved',
		() => 'rejected',
	)
	const socket = instance.tcpSocket
	instance.cleanup()
	try {
		assert.equal(await Promise.race([pending, delay(300).then(() => 'pending')]), 'rejected')
		assert.equal(socket.destroyed, true)
	} finally {
		dispose(instance)
	}
})

for (const stage of ['main-bind', 'listener-bind', 'send']) {
	test(`UDP cancellation during ${stage} settles startup and frees both ports`, async () => {
		const sink = await loopbackSocket()
		const instance = connection()
		instance.initialServerPort = sink.address().port
		let cancelled = false
		const cancel = () => {
			cancelled = true
			instance.cleanup()
		}
		if (stage === 'send')
			instance.emitter.on('status', (type, message) => {
				if (type === 'CONNECTING' && message.includes('Initial')) cancel()
			})
		const pending = instance.startUdp().then(
			() => 'resolved',
			() => 'rejected',
		)
		if (stage === 'main-bind') cancel()
		if (stage === 'listener-bind') instance.mainClient.once('listening', cancel)
		try {
			assert.equal(await Promise.race([pending, delay(300).then(() => 'pending')]), 'rejected')
			await new Promise((resolve) => setImmediate(resolve))
			assert.equal(cancelled, true)
			assert.equal(boundPort(instance.mainClient), null)
			assert.equal(boundPort(instance.listenerClient), null)
		} finally {
			dispose(instance)
			close(sink)
		}
	})
}

// Exercise every delay in TCP AUTH/registration without sending real commands.
for (let boundary = 1; boundary <= 8; boundary++) {
	test(`TCP cancellation at startup wait ${boundary} prevents later writes`, async () => {
		const { EventEmitter } = require('node:events')
		const instance = connection()
		const socket = new EventEmitter()
		let writes = 0
		let writesAtCancel
		socket.write = () => {
			writes++
			return true
		}
		socket.destroy = () => {
			socket.destroyed = true
			socket.emit('close')
		}
		instance.tcpSocket = socket
		instance.tcpWaitForFrame = async () => true
		const sleep = instance.sleep.bind(instance)
		let waits = 0
		instance.sleep = () => {
			if (++waits === boundary)
				queueMicrotask(() => {
					writesAtCancel = writes
					instance.cleanup()
				})
			return sleep(0)
		}
		try {
			await assert.rejects(instance.startTcp(), /cancelled/)
			assert.equal(waits, boundary)
			assert.equal(writes, writesAtCancel)
			assert.equal(socket.destroyed, true)
			assert.equal(instance.mainClient, null)
		} finally {
			dispose(instance)
		}
	})
}

test('TCP auth-response cancellation must not reset isClosing or fall back to UDP', async () => {
	const { EventEmitter } = require('node:events')
	const instance = connection()
	const socket = new EventEmitter()
	socket.write = () => true
	socket.destroy = () => {
		socket.destroyed = true
		socket.emit('close')
	}
	instance.tryTcpConnect = async () => {
		instance.tcpSocket = socket
		return true
	}
	instance.sleep = async () => {}
	const wait = instance.tcpWaitForFrame.bind(instance)
	instance.tcpWaitForFrame = (ms) => {
		const pending = wait(ms)
		instance.cleanup()
		return pending
	}
	try {
		await assert.rejects(instance.start(), /cancelled/)
		assert.equal(instance.isClosing, true)
		assert.equal(instance.mainClient, null)
		assert.equal(socket.listenerCount('data'), 0)
	} finally {
		dispose(instance)
	}
})

test('An old cancelled attempt cannot remove a replacement connection', async () => {
	const manager = require('../dist/protocol/connection-manager.cjs')
	const original = HandshakeConnection.prototype.start
	let rejectOld
	let calls = 0
	HandshakeConnection.prototype.start = function () {
		if (++calls === 1)
			return new Promise((resolve, reject) => {
				rejectOld = reject
			})
		return Promise.resolve(() => this.cleanup())
	}
	const args = ['replacement-review', '127.0.0.1', 'suite1a', { mainPort: 0, listenerPort: 0 }]
	try {
		const old = manager.createConnection(...args).catch(() => {})
		await manager.disconnectConnection(args[0])
		await manager.createConnection(...args)
		rejectOld(new Error('cancelled'))
		await old
		assert.ok(manager.getActiveConnections().includes(args[0]))
	} finally {
		await manager.disconnectConnection(args[0])
		HandshakeConnection.prototype.start = original
	}
})
