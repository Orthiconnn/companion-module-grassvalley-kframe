// Run after build: node --test test/repro-module-round3.mjs
// Module/UI regressions from the third review round. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { UpdateFeedbacks } from '../dist/feedbacks.js'
import { protocol } from '../dist/protocol.js'
import { labeledButtonSvg } from '../dist/badges.js'
import { UpgradeScripts } from '../dist/upgrades.js'
import { maximumRetries } from '../dist/config.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const svg = (png64) => Buffer.from(png64, 'base64').toString()

function setup() {
	const module = new Module({ _isInstanceContext: true, id: 'round3' })
	module.checkFeedbacks = () => {}
	module.setVariableValues = (values) => (module.vars = { ...(module.vars ?? {}), ...values })
	module.updateStatus = () => {}
	module.log = () => {}
	let actions, feedbacks
	module.setActionDefinitions = (defs) => (actions = defs)
	module.setFeedbackDefinitions = (defs) => (feedbacks = defs)
	UpdateActions(module)
	UpdateFeedbacks(module)
	return { module, actions, feedbacks }
}
const action = (id, options, controlId = 'btn') => ({
	id,
	controlId,
	options: { suite: 'suite1a', textSize: 100, showSuite: true, ...options },
})
function patch(object, overrides) {
	const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]))
	Object.assign(object, overrides)
	return () => Object.assign(object, saved)
}

test('keyer Auto transition button does not show the M/E primary progress strip', () => {
	const { actions, feedbacks } = setup()
	const restore = patch(protocol, {
		getTransitionTelemetry: (id, did) => (did === 0x03000003 ? { ramp: 0.5, active: true } : null),
	})
	try {
		actions.transition.subscribe(action('k', { target: 'PGM_KEY1', transition: 'auto' }))
		const keyer = feedbacks.transition_button_state.callback({ controlId: 'btn', options: {} })
		assert.equal(/fill="#98e700"/.test(svg(keyer.png64)), false)
		actions.transition.subscribe(action('p', { target: 'PGM_PRI', transition: 'auto' }, 'pri'))
		const primary = feedbacks.transition_button_state.callback({ controlId: 'pri', options: {} })
		assert.equal(/fill="#98e700"/.test(svg(primary.png64)), true, 'PRI still shows its strip')
	} finally {
		restore()
	}
})

test('eDPM E-MEM button keeps the user background instead of clearing it', () => {
	const { actions, feedbacks } = setup()
	actions.emem.subscribe(action('e', { target: 'eDPM-PRI', register: 5 }))
	const result = feedbacks.emem_button_state.callback({ controlId: 'btn', options: {} })
	assert.equal('bgcolor' in result, false)
})

test('timeline progress follows the RUN action suite', () => {
	const { actions, feedbacks } = setup()
	const asked = []
	const restore = patch(protocol, { getTimelineState: (id) => (asked.push(id), null) })
	try {
		actions.run.subscribe(action('r', { target: 'MASTER', suite: 'suite2a' }))
		feedbacks.timeline_progress.callback({ controlId: 'btn', options: { suite: 'suite1a' } })
		assert.deepEqual(asked, ['round3:suite2a'])
	} finally {
		restore()
	}
})

test('unexpected disconnect clears protocol and frame version variables', () => {
	const { module } = setup()
	module.config = { host: '127.0.0.1', suite1: false, suite2: false, suite3: false, suite4: false, maxRetries: 0 }
	const subscriptions = [
		'subscribeToSourceNames',
		'subscribeToAuxBus',
		'subscribeToMEBus',
		'subscribeToMasterTimeline',
		'subscribeToImageStore',
		'subscribeToTransitionTelemetry',
	]
	const restore = patch(protocol, {
		getConnectionInfo: () => ({ protocol: 'tcp', frameVersion: 'V18.1.0', ports: { dynamic: 5000 } }),
		...Object.fromEntries(subscriptions.map((key) => [key, () => ({ success: true, message: '' })])),
	})
	try {
		module.handleProtocolStatus('round3:suite1a', 'CONNECTED', '')
		module.handleProtocolStatus('round3:suite1a', 'HEARTBEAT_ACK', '')
		module.handleProtocolStatus('round3:suite1a', 'DISCONNECTED', 'closed by frame')
		assert.equal(module.vars.suite1_protocol, '')
		assert.equal(module.vars.suite1_frame_version, '')
		assert.equal(module.suiteStates.suite1a.heartbeatFlash, false)
		assert.equal(module.suiteStates.suite1a.timer, undefined)
	} finally {
		restore()
		clearTimeout(module.sourceRefreshTimer)
	}
})

test('destroy() during configUpdated() prevents any reconnect afterward', async () => {
	const { module } = setup()
	module.updateActions = () => {}
	module.updatePresets = () => {}
	module.config = { host: '127.0.0.1', suite1: true }
	const created = []
	const restore = patch(protocol, {
		createConnection: async (id, host) => (created.push([id, host]), () => {}),
		disconnectConnection: async () => delay(50),
	})
	try {
		const pending = module.configUpdated({ host: '127.0.0.1', suite1: true, maxRetries: 0 })
		await delay(5)
		await module.destroy()
		await pending
		await delay(80)
		assert.deepEqual(created, [])
		assert.equal(module.shuttingDown, true)
	} finally {
		restore()
	}
})

test('button shows the same assignment regardless of subscription order', () => {
	for (const order of [
		['a', 'b'],
		['b', 'a'],
	]) {
		const { module, actions } = setup()
		const defs = {
			a: action('a', { value: 1, labelOverride: 'A', suite: 'suite1a' }),
			b: action('b', { value: 2, labelOverride: 'B', suite: 'suite2a' }),
		}
		for (const id of order) actions.macro_play.subscribe(defs[id])
		assert.equal(module.macroButtons.get('btn').labelOverride, 'A', `order ${order}`)
		assert.equal(module.primarySuiteButton('btn').suite, 'suite1a', `order ${order}`)
	}
})

test('labels with XML-invalid control characters still produce valid SVG text', () => {
	const out = svg(labeledButtonSvg(1, 'HEAD\u0007', 'SRC\u0001\u001f&<', 0xffffff))
	assert.equal(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(out.replace(/[\t\n\r]/g, '')), false)
	assert.ok(out.includes('SRC&amp;&lt;'))
})

test('200% text size never renders text wider than the button', () => {
	for (const [heading, source] of [
		['PGM KEY1', 'CAMERA 15 WIDE'],
		['MASTER', 'A'],
		['ME1 PRI', 'A very long source name over twenty chars'],
	]) {
		const out = svg(labeledButtonSvg(1, heading, source, 0xffffff, undefined, 2))
		for (const [, size, attrs, text] of out.matchAll(/<text [^>]*font-size="(\d+)"([^>]*)>([^<]*)</g)) {
			const width = [...text].length * 0.6 * Number(size)
			assert.ok(width <= 300 || attrs.includes('textLength="300"'), `${text} at ${size}px is ~${width}px wide`)
		}
	}
	// A short label still grows at 200%.
	assert.match(svg(labeledButtonSvg(1, 'ME1', '7', 0xffffff, undefined, 2)), /font-size="1(1[0-9]|20)"/)
})

test('maxRetries: blank, null, and text migrate to the default, numbers are clamped', () => {
	assert.equal(maximumRetries({ maxRetries: '' }), 5)
	assert.equal(maximumRetries({ maxRetries: null }), 5)
	assert.equal(maximumRetries({ maxRetries: 'abc' }), 5)
	assert.equal(maximumRetries({ maxRetries: '3' }), 3)
	assert.equal(maximumRetries({ maxRetries: 99 }), 20)
	assert.equal(maximumRetries({ maxRetries: 0 }), 0)
	for (const maxRetries of ['', null, 'abc']) {
		const config = { host: '192.0.2.1', suite: 'suite1a', maxRetries }
		const result = UpgradeScripts[0]({ currentConfig: config }, { config, secrets: null, actions: [], feedbacks: [] })
		assert.equal(result.updatedConfig.maxRetries, 5, `legacy maxRetries ${JSON.stringify(maxRetries)}`)
	}
})

test('connect wait resolves on the status event, not a polling tick', async () => {
	const { module } = setup()
	module.suiteStates.suite1a.status = 'connecting'
	const started = Date.now()
	const pending = module.waitForSuiteConnection('suite1a', 5000)
	setTimeout(() => {
		module.suiteStates.suite1a.status = 'connected'
		module.updateRuntimeState()
	}, 5)
	assert.equal(await pending, true)
	assert.ok(Date.now() - started < 60, 'waited for a polling interval')
	assert.equal(module.suiteStatusWaiters.size, 0, 'waiter not removed')
	module.suiteStates.suite1a.status = 'connecting'
	assert.equal(await module.waitForSuiteConnection('suite1a', 20), false, 'timeout resolves false')
	assert.equal(module.suiteStatusWaiters.size, 0)
})
