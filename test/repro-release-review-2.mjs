// Run after build: node --test test/repro-release-review-2.mjs
// Sixth review: malformed targets and blank/odd numbers became live actions, two
// quick PBUS presses interleaved on the wire, and a config save dropped manually
// connected suites and reconnected manually disconnected ones. No sockets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Module from '../dist/main.js'
import { UpdateActions } from '../dist/actions.js'
import { protocol } from '../dist/protocol.js'

function patch(object, overrides) {
	const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, object[key]]))
	Object.assign(object, overrides)
	return () => Object.assign(object, saved)
}
function setup(config = { host: '192.0.2.10', suite1: true }) {
	const module = new Module({ _isInstanceContext: true, id: 'release2' })
	Object.assign(module, {
		updateStatus() {},
		setVariableValues() {},
		checkFeedbacks() {},
		log() {},
		updateActions() {},
		updatePresets() {},
	})
	module.config = config
	let actions
	module.setActionDefinitions = (defs) => (actions = defs)
	UpdateActions(module)
	return { module, actions }
}
const ok = { success: true, message: '' }
const run = (actions, id, options) => actions[id].callback({ options: { suite: 'suite1a', ...options } })

test('malformed targets are rejected instead of firing a live default', () => {
	const { actions } = setup()
	const sent = []
	const restore = patch(protocol, {
		sendTransitionEvent: (...a) => (sent.push(a), ok),
		sendCrosspoint: (...a) => (sent.push(a), ok),
		sendEMem: (...a) => (sent.push(a), ok),
		sendEMemTargeted: (...a) => (sent.push(a), ok),
		sendTimelineEvent: (...a) => (sent.push(a), ok),
	})
	try {
		for (const target of ['PGM_pri', 'PGM_XYZ', 'PGM_PRI_x', 'ME1_BOTH_x'])
			assert.throws(() => run(actions, 'transition', { target, transition: 'cut' }), /Invalid transition target/)
		for (const target of ['PGM_A_x', 'PGM_a', 'ME9_A'])
			assert.throws(() => run(actions, 'crosspoint', { target, source: 1 }), /Invalid crosspoint target/)
		for (const target of ['ME1-PRI-x', 'ME1-pri', 'master'])
			assert.throws(() => run(actions, 'emem', { target, register: 1 }), /Invalid E-MEM target/)
		for (const target of ['ME1-BOTH-x', 'master'])
			assert.throws(() => run(actions, 'run', { target }), /Invalid timeline RUN target/)
		assert.throws(() => run(actions, 'timeline_edit', { target: 'ME9', command: 'next' }), /Invalid timeline target/)
		assert.deepEqual(sent, [])
	} finally {
		restore()
	}
})

test('blank or odd numbers are rejected instead of becoming 0, 1 or 16', () => {
	const { actions } = setup()
	const sent = []
	const restore = patch(protocol, {
		sendEMem: (_id, register) => (
			sent.push(['emem', register]),
			Number.isInteger(register) ? ok : { success: false, message: 'Invalid EMEM' }
		),
		sendMacro: (_id, macro) => (
			sent.push(['macro', macro]),
			Number.isInteger(macro) ? ok : { success: false, message: 'Invalid macro' }
		),
	})
	try {
		for (const register of ['', null, true, '0x10', ' '])
			assert.throws(() => run(actions, 'emem', { target: 'MASTER', register }))
		for (const value of [true, '0x10', '', '12.5']) assert.throws(() => run(actions, 'macro_play', { value }))
		assert.ok(sent.every(([, value]) => Number.isNaN(value) || !Number.isInteger(value)))
		run(actions, 'emem', { target: 'MASTER', register: '12' })
		run(actions, 'macro_play', { value: 5 })
		assert.deepEqual(sent.slice(-2), [
			['emem', 12],
			['macro', 5],
		])
	} finally {
		restore()
	}
})

test('two quick PBUS trigger presses run one after the other', async () => {
	const { actions } = setup()
	const frames = []
	const restore = patch(protocol, { sendRawCommand: (_id, command) => (frames.push(command.slice(8)), ok) })
	try {
		const play = run(actions, 'pbus_trigger', { pbus: 1, trigger: 0 })
		await new Promise((resolve) => setTimeout(resolve, 20))
		const stop = run(actions, 'pbus_trigger', { pbus: 1, trigger: 1 })
		await Promise.all([play, stop])
		assert.equal(frames.length, 8)
		// The first press's clear/select/fire/clear completes before the second starts.
		assert.equal(frames[3], frames[0])
		assert.notEqual(frames[1], frames[5])
	} finally {
		restore()
	}
})

for (const [name, config, change, live, manual, expectClosed, expectManual] of [
	[
		'a manually connected, unticked suite survives an unrelated save',
		{ suite1: true, suite2: false },
		{ maxRetries: 9 },
		['suite1a', 'suite2a'],
		[],
		[],
		[],
	],
	[
		'a manually disconnected suite stays disconnected after an unrelated save',
		{ suite1: true, suite2: true },
		{ maxRetries: 9 },
		['suite1a'],
		['suite2a'],
		[],
		['suite2a'],
	],
	[
		'ticking a manually disconnected suite re-enables it',
		{ suite1: true, suite2: false },
		{ suite2: true },
		['suite1a'],
		['suite2a'],
		[],
		[],
	],
	[
		'a new IP re-enables manually disconnected suites',
		{ suite1: true, suite2: true },
		{ host: '192.0.2.11' },
		['suite1a'],
		['suite2a'],
		['suite1a', 'suite2a', 'suite3a', 'suite4a'],
		[],
	],
])
	test(`config save: ${name}`, async () => {
		const base = { host: '192.0.2.10', suite3: false, suite4: false, maxRetries: 5, ...config }
		const { module } = setup(base)
		for (const id of live) module.suiteStates[id].status = 'connected'
		for (const id of manual) module.manuallyDisconnectedSuites.add(id)
		const closed = []
		const restore = patch(protocol, { disconnectConnection: async (id) => closed.push(id) })
		module.connectSuite = async () => true
		try {
			await module.configUpdated({ ...base, ...change })
			const closedSuites = ['suite1a', 'suite2a', 'suite3a', 'suite4a'].filter((id) =>
				closed.includes(module.connectionId(id)),
			)
			if (expectClosed.length) assert.deepEqual(closedSuites, expectClosed)
			else for (const id of live) assert.ok(!closedSuites.includes(id), `${id} was dropped`)
			assert.deepEqual([...module.manuallyDisconnectedSuites].sort(), expectManual)
		} finally {
			restore()
			await module.destroy()
		}
	})
