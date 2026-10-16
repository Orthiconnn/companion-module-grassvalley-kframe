// Run after build: node --test test/repro-timeline-bytes.cjs
// sendTimelineEvent must reject values Buffer.from() would silently wrap or zero. No sockets.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

function connected() {
	const connection = new HandshakeConnection('timeline', '127.0.0.1', 'suite1a', {}, 'Timeline', '0', 'test')
	connection.mainHandshakeStage = 9
	const sent = []
	connection.sendToFrame = (packet, callback) => {
		sent.push(packet)
		callback?.(null)
	}
	return { connection, sent }
}

test('out-of-range timeline values are rejected and nothing is sent', () => {
	const { connection, sent } = connected()
	for (const [eid, did, data] of [
		[2, 0x02000000, [256]],
		[2, 0x02000000, [-1]],
		[2, 0x02000000, [1.5]],
		[2, 0x02000000, [NaN]],
		[0x10000, 0x02000000, []],
		[-1, 0x02000000, []],
		[2, 0x100000000, []],
		[2, -1, []],
	])
		assert.equal(connection.sendTimelineEvent(eid, did, data).success, false, JSON.stringify([eid, did, data]))
	assert.equal(sent.length, 0)
})

test('valid timeline events are sent', () => {
	const { connection, sent } = connected()
	assert.equal(connection.sendTimelineEvent(0x0002, 0x35000001, []).success, true)
	assert.equal(connection.sendTimelineEvent(0x0002, 0x02000003, [2]).success, true)
	assert.equal(sent.length, 2)
})
