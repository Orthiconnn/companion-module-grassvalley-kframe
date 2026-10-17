// Run after build: node --test test/repro-release-review.mjs
// Release review findings: commands for an unknown suite fell back to Suite 1, any
// config save dropped every live suite, and a late Packet-10 send callback could
// throw after cleanup. Loopback only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import dgram from 'node:dgram'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { protocol } from '../dist/protocol.js'

const HandshakeConnection = createRequire(import.meta.url)('../dist/protocol/handshake-connection-class.cjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function patch(object, overrides) {
	const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]))
	Object.assign(object, overrides)
	return () => Object.assign(object, saved)
}
function setup(config) {
	const module = new Module({ _isInstanceContext: true, id: 'release' })
	module.updateStatus = () => {}
	module.setVariableValues = () => {}
	module.checkFeedbacks = () => {}
	module.log = () => {}
	module.updateActions = () => {}
	module.updatePresets = () => {}
	module.config = config
	let actions
	module.setActionDefinitions = (defs) => (actions = defs)
	UpdateActions(module)
	return { module, actions }
}

test('a command for an unknown suite is rejected, not sent to Suite 1', async () => {
	const { module, actions } = setup({ host: '192.0.2.10', suite1: true })
	const sent = []
	const restore = patch(protocol, { sendMacro: (id) => (sent.push(id), { success: true, message: '' }) })
	try {
		for (const suite of ['suite5a', 2, 'Suite 2', 'suite1b', undefined])
			assert.throws(() => actions.macro_play.callback({ options: { suite, value: 1 } }), /Invalid suite/)
		assert.deepEqual(sent, [])
		actions.macro_play.callback({ options: { suite: 'suite2a', value: 1 } })
		assert.deepEqual(sent, [module.connectionId('suite2a')])
		await assert.rejects(async () => actions.disconnect.callback({ options: { suite: 'Suite 3' } }), /Invalid suite/)
		assert.throws(() => actions.connect.callback({ options: { suite: 3 } }), /Invalid suite/)
	} finally {
		restore()
	}
})

for (const [name, change, expected] of [
	['ticking another suite', { suite3: true }, []],
	['changing the retry count', { maxRetries: 9 }, []],
	['unticking Suite 1', { suite1: false }, ['suite1a']],
	['changing the IP', { host: '192.0.2.11' }, ['suite1a', 'suite2a']],
])
	test(`config save: ${name}`, async () => {
		const config = { host: '192.0.2.10', suite1: true, suite2: true, suite3: false, suite4: false, maxRetries: 5 }
		const { module } = setup(config)
		module.suiteStates.suite1a.status = 'connected'
		module.suiteStates.suite2a.status = 'connected'
		const closed = []
		const restore = patch(protocol, { disconnectConnection: async (id) => closed.push(id) })
		module.connectSuite = async () => true
		try {
			await module.configUpdated({ ...config, ...change })
			const live = ['suite1a', 'suite2a']
			const dropped = live.filter((id) => closed.includes(module.connectionId(id)))
			assert.deepEqual(dropped, expected)
			for (const id of live.filter((id) => !expected.includes(id)))
				assert.equal(module.suiteStates[id].status, 'connected', `${id} was dropped`)
		} finally {
			restore()
			await module.destroy()
		}
	})

test('a Packet-10 send callback after cleanup does not throw', async () => {
	const connection = new HandshakeConnection(
		'p10',
		'127.0.0.1',
		'suite1a',
		{ mainPort: 0, listenerPort: 0 },
		'P10',
		'0',
		't',
	)
	connection.mainClient = dgram.createSocket('udp4')
	await new Promise((resolve) => connection.mainClient.bind(0, '127.0.0.1', resolve))
	let callback
	connection.listenerClient = { send: (_m, _p, _a, cb) => (callback = cb), close() {}, removeAllListeners() {} }
	connection.mainHandshakeStage = 5
	const announcement = Buffer.alloc(20)
	announcement.writeUInt16BE(40000, 18)
	connection.handleListenerClientMessage(announcement, {
		port: connection.portAnnounceServerPort,
		address: '127.0.0.1',
	})
	connection.cleanup()
	assert.doesNotThrow(() => callback(null))
	await delay(10)
})

test('a failed TCP detection releases its socket', async () => {
	const net = await import('node:net')
	const server = net.createServer()
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const port = server.address().port
	await new Promise((resolve) => server.close(resolve))
	const connection = new HandshakeConnection('tcp', '127.0.0.1', 'suite1a', {}, 'Tcp', '0', 't')
	connection.initialServerPort = port
	await assert.rejects(connection.tryTcpConnect())
	assert.equal(connection.tcpSocket, null)
})
