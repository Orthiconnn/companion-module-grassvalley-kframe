// Run: npm run build && node --test test/repro-keyer-tally.mjs
// Regression: keyer writes must not overwrite the A-D bus-state cache.
// The transport is stubbed: this test creates no sockets and sends no packets.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { UpdateActions } from '../dist/actions.js'
import { UpdateFeedbacks } from '../dist/feedbacks.js'

const require = createRequire(import.meta.url)
const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

test('Selecting ME1 Key 1 must preserve ME1 A source and tally', (t) => {
	const connection = new HandshakeConnection('review', '127.0.0.1', 'suite1a', {}, 'Review', '0', 'test')
	connection.mainHandshakeStage = 9
	connection.fullyConnected = true
	connection.meState.set(0, 10) // Initial frame state: ME1 A selects source 10.
	const packets = []
	connection.sendToFrame = (packet, callback) => {
		packets.push(packet)
		callback(null) // Successful local send, with no actual network operation.
	}
	let actions
	let feedbacks
	const self = {
		connectionId: (suite) => suite,
		sourceChoices: () => [],
		macroChoices: () => [],
		setActionDefinitions: (definitions) => {
			actions = definitions
		},
		setFeedbackDefinitions: (definitions) => {
			feedbacks = definitions
		},
		crosspointButtons: new Map(
			[10, 42].map((source) => [
				`source-${source}`,
				{ suite: 'suite1a', target: 'ME1_A', source, textSize: 1, labelOverride: '' },
			]),
		),
		protocol: {
			sendCrosspoint: (_id, ...args) => connection.sendCrosspoint(...args),
			getMESource: (_id, address) => connection.meState.get(address) ?? null,
			resolveSourceDisplayName: (_id, source) => `Source ${source}`,
		},
	}
	UpdateActions(self)
	UpdateFeedbacks(self)
	const tally = (source) =>
		feedbacks.crosspoint_button_state.callback({
			controlId: `source-${source}`,
			options: { automaticLabel: false },
		}).bgcolor === 0xff0000
	const snapshot = () => ({ cachedME1A: connection.meState.get(0), source10Tally: tally(10), source42Tally: tally(42) })
	try {
		const before = snapshot()
		assert.deepEqual(before, { cachedME1A: 10, source10Tally: true, source42Tally: false })
		actions.crosspoint.callback({ options: { suite: 'suite1a', target: 'ME1_K1', source: 42 } })
		assert.equal(packets.length, 1)
		assert.equal(packets[0].readUInt16BE(16), 0x103a, 'Command must target keyer source PID')
		assert.equal(packets[0].readUInt32BE(20), 0x08000000, 'Command must target ME1 Key 1, not ME1 A')
		t.diagnostic(`Before keyer selection: ${JSON.stringify(before)}`)
		t.diagnostic(`After ME1 Key 1 -> source 42: ${JSON.stringify(snapshot())}`)
		assert.deepEqual(snapshot(), before, 'Changing Key 1 must not change ME1 A cache or tally')
		actions.crosspoint.callback({ options: { suite: 'suite1a', target: 'ME1_A', source: 42 } })
		assert.equal(packets[1].readUInt16BE(16), 0x104a)
		assert.deepEqual(
			snapshot(),
			{ cachedME1A: 42, source10Tally: false, source42Tally: true },
			'A real ME1 A selection must still update its cache and tally',
		)
	} finally {
		connection.cleanup()
	}
})

test('All 30 keyer targets preserve the 20 bus states and emit no bus-change feedback', () => {
	const connection = new HandshakeConnection('review', '127.0.0.1', 'suite1a', {}, 'Review', '0', 'test')
	connection.mainHandshakeStage = 9
	connection.fullyConnected = true
	connection.sendToFrame = (_packet, callback) => callback(null)
	for (let me = 0; me < 5; me++) {
		for (let bus = 0; bus < 4; bus++) connection.meState.set(bus * 0x10 + me, 10 + bus + me)
	}
	const before = new Map(connection.meState)
	const busChanges = []
	connection.emitter.on('meStateChanged', (event) => busChanges.push(event))
	try {
		for (let me = 0; me < 5; me++) {
			for (let key = 0; key < 6; key++) {
				const result = connection.sendCrosspoint(0x103a, 0x08000000 + key * 0x10 + me, 42)
				assert.equal(result.success, true)
				assert.deepEqual(connection.meState, before)
			}
		}
		assert.deepEqual(busChanges, [])
	} finally {
		connection.cleanup()
	}
})

for (const target of ['ME1_A', 'ME1_K1']) {
	test(`${target}: invalid crosspoint sources send no command or feedback changes`, () => {
		const connection = new HandshakeConnection('validation', '127.0.0.1', 'suite1a', {}, 'Review', '0', 'test')
		connection.mainHandshakeStage = 9
		connection.fullyConnected = true
		connection.meState.set(0, 42)
		connection.keyerState.set(0, 43)
		const packets = [],
			events = []
		connection.sendToFrame = (packet, callback) => {
			packets.push(packet)
			callback(null)
		}
		connection.emitter.on('meStateChanged', (event) => events.push(event))
		let actions
		UpdateActions({
			connectionId: (suite) => suite,
			sourceChoices: () => [],
			macroChoices: () => [],
			setActionDefinitions: (value) => {
				actions = value
			},
			protocol: { sendCrosspoint: (_id, ...args) => connection.sendCrosspoint(...args) },
		})
		try {
			for (const source of [
				undefined,
				null,
				'',
				' ',
				'not-a-number',
				NaN,
				Infinity,
				-Infinity,
				0,
				-1,
				810,
				1.5,
				'1.5',
				true,
				false,
				[1],
				{},
			]) {
				assert.throws(
					() => actions.crosspoint.callback({ options: { suite: 'suite1a', target, source } }),
					/Invalid source number/,
					`Must reject ${String(source)}`,
				)
			}
			assert.equal(packets.length, 0)
			assert.deepEqual(events, [])
			assert.equal(connection.getMESource(0), 42)
			assert.equal(connection.getKeyerSource(0), 43)
		} finally {
			connection.cleanup()
		}
	})

	test(`${target}: valid crosspoint source boundaries and numeric strings encode exactly`, () => {
		const connection = new HandshakeConnection('validation', '127.0.0.1', 'suite1a', {}, 'Review', '0', 'test')
		connection.mainHandshakeStage = 9
		connection.fullyConnected = true
		const packets = []
		connection.sendToFrame = (packet, callback) => {
			packets.push(packet)
			callback(null)
		}
		let actions
		UpdateActions({
			connectionId: (suite) => suite,
			sourceChoices: () => [],
			macroChoices: () => [],
			setActionDefinitions: (value) => {
				actions = value
			},
			protocol: { sendCrosspoint: (_id, ...args) => connection.sendCrosspoint(...args) },
		})
		try {
			for (const source of [1, 809, '1', '809', 42]) {
				actions.crosspoint.callback({ options: { suite: 'suite1a', target, source } })
				assert.equal(packets.at(-1).readUInt16BE(packets.at(-1).length - 2), Number(source))
				if (target === 'ME1_A') assert.equal(connection.getMESource(0), Number(source))
			}
			assert.equal(packets.length, 5)
		} finally {
			connection.cleanup()
		}
	})
}
