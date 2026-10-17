// Run after build: node --test test/repro-connect-action-timeout.mjs
// Companion fails an action call after a few seconds, but a suite handshake can
// take up to 20 s. Connect actions start the connection and return at once. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'connect-timeout' })
	module.checkFeedbacks = () => {}
	module.logged = []
	module.log = (level, message) => module.logged.push([level, message])
	let actions
	module.setActionDefinitions = (defs) => (actions = defs)
	UpdateActions(module)
	return { module, actions }
}
const within = (promise, ms) =>
	Promise.race([promise.then(() => 'returned'), new Promise((resolve) => setTimeout(() => resolve('blocked'), ms))])

for (const id of ['connect', 'connection_toggle'])
	test(`${id} returns before a slow handshake finishes`, async () => {
		const { module, actions } = setup()
		const started = []
		module.connectSuite = (suite) => {
			started.push(suite)
			return new Promise(() => {})
		}
		assert.equal(
			await within(Promise.resolve(actions[id].callback({ options: { suite: 'suite2a' } })), 200),
			'returned',
		)
		assert.deepEqual(started, ['suite2a'])
	})

test('a failed background connect is logged, not thrown', async () => {
	const { module, actions } = setup()
	module.connectSuite = async () => {
		throw new Error('socket bind failed')
	}
	await actions.connect.callback({ options: { suite: 'suite1a' } })
	await new Promise((resolve) => setImmediate(resolve))
	assert.ok(module.logged.some(([level, message]) => level === 'warn' && message.includes('socket bind failed')))
})
