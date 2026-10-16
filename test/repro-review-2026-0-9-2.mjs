// Run after build: node --test test/repro-review-2026-0-9-2.mjs
// Repros for the confirmed review findings fixed in 2026.0.9.3 (found on 2026.0.9.2). Loopback only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import Module from '../dist/main.js'
import { protocol } from '../dist/protocol.js'
import { UpgradeScripts } from '../dist/upgrades.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(config = {}) {
	const module = new Module({ _isInstanceContext: true, id: 'review-repro' })
	const statuses = []
	let feedbackChecks = 0
	module.updateStatus = (status, message) => statuses.push([status, message])
	module.checkFeedbacks = () => feedbackChecks++
	module.setVariableValues = () => {}
	module.log = () => {}
	module.config = config
	return { module, statuses, feedbackChecks: () => feedbackChecks }
}

// Companion stores the last upgrade index per connection and only runs scripts after it.
function companionUpgrade(lastUpgradeIndex, props) {
	let config = props.config
	for (let i = lastUpgradeIndex + 1; i < UpgradeScripts.length; i++) {
		const result = UpgradeScripts[i]({ currentConfig: config }, { ...props, config })
		if (result.updatedConfig) config = result.updatedConfig
	}
	return { config, actions: props.actions }
}

test('kframe 0.9.1 connection (3 upgrade scripts already run) still receives new upgrades', () => {
	// grassvalley-kframe-0.9.1.tgz shipped 3 scripts: suite fill + 2x textSize -> lastUpgradeIndex 2.
	const action = {
		id: 'a',
		controlId: 'bank:a',
		actionId: 'macro_play',
		options: { suite: { value: 'suite1a', isExpression: false }, value: { value: 1, isExpression: false } },
	}
	const upgraded = companionUpgrade(2, {
		config: { host: '192.0.2.10' },
		secrets: null,
		actions: [action],
		feedbacks: [],
	})
	assert.ok('maxRetries' in upgraded.config, 'config must gain maxRetries/suite1-4 keys')
	assert.notEqual(action.options.showSuite, undefined, 'actions must gain showSuite option')
})

test('BadConfig "Target IP is required" clears once a host is set', async () => {
	const { module, statuses } = setup({ host: '' })
	module.updateRuntimeState() // as init() does
	assert.equal(await module.connectSuite('suite1a'), false)
	assert.equal(statuses.at(-1)[1], 'Target IP is required')
	module.config = { host: '192.0.2.10' }
	module.updateRuntimeState() // as configUpdated() does
	assert.notEqual(statuses.at(-1)[1], 'Target IP is required', 'stale BadConfig remains visible')
})

test('destroy() cancels the heartbeat flash timer', async () => {
	const { module, feedbackChecks } = setup({ host: '' })
	module.handleProtocolStatus(module.connectionId('suite1a'), 'HEARTBEAT_ACK', '')
	await module.destroy()
	const afterDestroy = feedbackChecks()
	await delay(400)
	assert.equal(feedbackChecks(), afterDestroy, 'checkFeedbacks ran after destroy()')
})

test('send failures are reported as non-fatal WARNING, not ERROR', () => {
	const source = readFileSync(new URL('../dist/protocol/handshake-connection-class.cjs', import.meta.url), 'utf8')
	const fatal = [...source.matchAll(/'status', 'ERROR', `([^`$]*)/g)].map((m) => m[1]).sort()
	assert.deepEqual(fatal, ['Error sending Packet 1: ', 'Listener Client error: ', 'Main Client error: ', 'TCP error: '])
})

test('a WARNING on a connected suite keeps it connected and queues no reconnect', async () => {
	const { module } = setup({ host: '192.0.2.10', suite1: true })
	let reconnects = 0
	module.connectAutomatically = async () => {
		reconnects++
	}
	module.suiteStates.suite1a.status = 'connected'
	module.handleProtocolStatus(module.connectionId('suite1a'), 'WARNING', 'Error sending crosspoint: EHOSTUNREACH')
	await delay(10)
	assert.equal(module.suiteStates.suite1a.status, 'connected', 'suite marked disconnected')
	assert.equal(reconnects, 0, 'automatic reconnect queued')
})

test('a fatal ERROR on a connected suite still disconnects and reconnects', async () => {
	const { module } = setup({ host: '192.0.2.10', suite1: true })
	let reconnects = 0
	module.connectAutomatically = async () => {
		reconnects++
	}
	module.suiteStates.suite1a.status = 'connected'
	module.handleProtocolStatus(module.connectionId('suite1a'), 'ERROR', 'TCP error: ECONNRESET')
	await delay(10)
	assert.equal(module.suiteStates.suite1a.status, 'disconnected')
	assert.equal(reconnects, 1)
})

test('manual Connect is not torn down by its own startup aux-state ERROR', async () => {
	const { module } = setup({ host: '127.0.0.1', suite1: true })
	protocol.initialize(null)
	protocol.clientEmitter.on('status', module.handleProtocolStatus)
	const startupErrors = []
	const spy = (id, type, message) => type === 'ERROR' && startupErrors.push(message)
	protocol.clientEmitter.on('status', spy)
	let reconnects = 0
	module.connectAutomatically = async () => {
		reconnects++
	}
	try {
		const pending = module.connectSuite('suite1a')
		await delay(50)
		assert.deepEqual(startupErrors, [], 'startup emitted ERROR')
		assert.equal(reconnects, 0, 'manual connect spawned an automatic reconnect')
		assert.notEqual(module.suiteStates.suite1a.status, 'disconnected', 'manual connect aborted by aux-state ERROR')
		void pending.catch(() => {})
	} finally {
		protocol.clientEmitter.off('status', spy)
		await module.destroy()
	}
})

test('catch-up upgrade is idempotent for kayenne beta.1 connections (index 1)', () => {
	const action = {
		id: 'b',
		controlId: 'bank:b',
		actionId: 'crosspoint',
		options: {
			suite: { value: 'suite3a', isExpression: false },
			textSize: { value: 80, isExpression: false },
			showSuite: { value: false, isExpression: false },
		},
	}
	const config = { host: '192.0.2.10', suite1: false, suite2: false, suite3: true, suite4: false, maxRetries: 7 }
	const upgraded = companionUpgrade(1, { config: { ...config }, secrets: null, actions: [action], feedbacks: [] })
	assert.deepEqual(upgraded.config, config)
	assert.equal(action.options.textSize.value, 80)
	assert.equal(action.options.showSuite.value, false)
})

test('kframe 0.9.1 catch-up enables the suites its actions reference', () => {
	const action = (suite) => ({
		id: suite,
		controlId: `bank:${suite}`,
		actionId: 'macro_play',
		options: { suite: { value: suite, isExpression: false }, textSize: { value: 100, isExpression: false } },
	})
	const upgraded = companionUpgrade(2, {
		config: { host: '192.0.2.10' },
		secrets: null,
		actions: [action('suite2a'), action('suite4a')],
		feedbacks: [],
	})
	assert.deepEqual(upgraded.config, {
		host: '192.0.2.10',
		suite1: false,
		suite2: true,
		suite3: false,
		suite4: true,
		maxRetries: 5,
	})
})

test('empty host stops the automatic retry loop after one attempt', async () => {
	const { module, statuses } = setup({ host: '', suite1: true, maxRetries: 5 })
	const logs = []
	module.log = (level, message) => logs.push(message)
	let attempts = 0
	const connect = module.connectSuite.bind(module)
	module.connectSuite = (...args) => {
		attempts++
		return connect(...args)
	}
	const started = Date.now()
	await module.connectAutomatically('suite1a', module.connectionConfigGeneration)
	assert.equal(attempts, 1)
	assert.ok(Date.now() - started < 500, 'retry loop waited between attempts')
	assert.equal(statuses.at(-1)[1], 'Target IP is required')
	assert.ok(!logs.some((m) => m.includes('maximum reconnection attempts')), 'misleading max-attempts warning')
	assert.equal(module.automaticRetryTimers.size, 0, 'retry scheduled without an IP')
})
