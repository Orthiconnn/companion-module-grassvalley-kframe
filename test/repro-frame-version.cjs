// Run after build: node --test test/repro-frame-version.cjs
// After a frame restart the first payload carrying a "V…" string can be a relayed
// client identity (this module announces V2026.0.9.x). Only frame versions count. No sockets.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

const connection = new HandshakeConnection(
	'version',
	'127.0.0.1',
	'suite1a',
	{},
	'Version',
	'2026.0.9.6',
	'Oct 16 2026',
)
const payload = (text) => Buffer.concat([Buffer.from([0, 4, 1, 2]), Buffer.from(text, 'latin1'), Buffer.from([0])])

test('a relayed client identity is not taken as the frame version', () => {
	assert.equal(connection.parseFrameInfo(payload('Companion - Suite 1\0V2026.0.9.6\0Oct 16 2026')).version, null)
})

test('the frame version is found next to a client identity', () => {
	const info = connection.parseFrameInfo(payload('V2026.0.9.6\0Kayenne\0V18.1.0\0Jun  3 2025'))
	assert.equal(info.version, 'V18.1.0')
	assert.equal(info.name, 'Kayenne')
})

test('V14 and V20 frame versions still parse', () => {
	assert.equal(connection.parseFrameInfo(payload('K-Frame V14.7.1')).version, 'V14.7.1')
	assert.equal(connection.parseFrameInfo(payload('Frame Facility Interface V20.0')).version, 'V20.0')
})
