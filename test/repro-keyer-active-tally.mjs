// Run: npm run build && node --test test/repro-keyer-active-tally.mjs
// Actual subscription parser and feedback, with synthetic frame responses; no sockets.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { UpdateFeedbacks } from '../dist/feedbacks.js'
const require = createRequire(import.meta.url)
const H = require('../dist/protocol/handshake-connection-class.cjs')
const make = () => new H('review', '127.0.0.1', 'suite1a', {}, null, 'Review', '0', 'test')
function response(pid, did, source) {
	const packet = Buffer.alloc(38)
	packet.writeUInt16BE(4, 0)
	packet.writeUInt16BE(2, 4)
	packet.writeUInt16BE(0x10, 6)
	packet.writeUInt32BE(22, 8)
	packet.writeUInt16BE(0x500, 16)
	packet.writeUInt16BE(pid, 24)
	packet.writeUInt32BE(did, 28)
	packet.writeUInt16BE(source, 36)
	return packet
}
for (const [me, index] of Object.entries({ ME1: 0, ME2: 1, ME3: 2, PGM: 3, ME4: 4 })) {
	for (const bus of ['B', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6']) {
		test(`${me} ${bus} follows frame source changes without mixing keyer and bus state`, () => {
			const h = make()
			let definitions
			const keyer = bus.startsWith('K')
			const address = index + (keyer ? Number(bus[1]) - 1 : 1) * 0x10
			const pid = keyer ? 0x103a : 0x104a
			const did = (keyer ? 0x08000000 : 0x04000000) + address
			// A matching source in the OTHER namespace must never activate this button.
			const other = keyer ? h.meState : h.keyerState
			other.set(address, 42)
			const events = []
			h.emitter.on('meStateChanged', (event) => events.push(event))
			const self = {
				connectionId: (suite) => suite,
				showSuiteDot: () => true,
				setFeedbackDefinitions: (value) => {
					definitions = value
				},
				crosspointButtons: new Map([
					['button', { suite: 'suite1a', target: `${me}_${bus}`, source: 42, textSize: 1, labelOverride: '' }],
				]),
				protocol: {
					getMESource: (_id, addr) => h.getMESource(addr),
					getKeyerSource: (_id, addr) => h.getKeyerSource(addr),
					resolveSourceDisplayName: () => 'Source 42',
				},
			}
			UpdateFeedbacks(self)
			const active = () =>
				definitions.crosspoint_button_state.callback({ controlId: 'button', options: { automaticLabel: false } })
					.bgcolor === 0xff0000
			try {
				assert.equal(active(), false, 'Unknown selection must not tally from the other namespace')
				h.handleSubscriptionData(response(pid, did, 10))
				assert.equal(active(), false)
				h.handleSubscriptionData(response(pid, did, 42))
				assert.equal(active(), true)
				h.handleSubscriptionData(response(pid, did, 11))
				assert.equal(active(), false)
				assert.equal(other.get(address), 42)
				assert.equal(events.length, 3)
				if (keyer) assert.ok(events.every((e) => e.kind === 'keyer'))
				h.cleanup()
				assert.equal(active(), false, 'Disconnect clears active source state')
			} finally {
				h.cleanup()
			}
		})
	}
}

test('Source subscriptions include all 30 keyers and 20 buses, once each', async () => {
	const h = make()
	h.mainHandshakeStage = 9
	const packets = []
	h.sendToFrame = (packet) => packets.push(packet)
	let timeout
	try {
		const completed = new Promise((resolve, reject) => {
			timeout = setTimeout(() => reject(Error('Subscription queue timed out')), 4000)
			h.emitter.on('status', (type) => {
				if (type === 'ME_SUBSCRIBED') resolve()
			})
		})
		assert.equal(h.subscribeToMEBus().success, true)
		assert.equal(h.subscribeToMEBus().success, true)
		await completed
		assert.equal(packets.length, 50)
		const keys = new Set(),
			buses = new Set()
		for (const packet of packets) {
			assert.equal(packet.readUInt16BE(6), 8, 'Only SUBSCRIBE commands permitted')
			const pid = packet.readUInt16BE(44),
				did = packet.readUInt32BE(48)
			if (pid === 0x103a) keys.add(did)
			else {
				assert.equal(pid, 0x104a)
				buses.add(did)
			}
		}
		assert.equal(keys.size, 30)
		assert.equal(buses.size, 20)
		for (let me = 0; me < 5; me++) for (let key = 0; key < 6; key++) assert.ok(keys.has(0x08000000 + key * 16 + me))
	} finally {
		clearTimeout(timeout)
		h.cleanup()
	}
})
