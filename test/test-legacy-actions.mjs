import assert from 'node:assert/strict'
import { buildButtonMapping, buildGpi, buildPbusRecall, buildPbusTrigger, buildRun } from '../dist/legacy-actions.js'

const maskMessageId = (command) => `${command.slice(0, 4)}xxxx${command.slice(8)}`

assert.equal(maskMessageId(buildRun('MASTER')), '0004xxxx00020005000000080000000f0002000035000001')
assert.equal(maskMessageId(buildRun('ME1-PRI')), '0004xxxx000200050000000900000010000200000200000000')
assert.equal(maskMessageId(buildRun('PGM-BOTH')), '0004xxxx000200050000000900000010000200000200000302')
assert.equal(maskMessageId(buildGpi(40)), '0004xxxx00020005000000080000000f00020000633d0027')

const recall = buildPbusRecall(24, 299).map(maskMessageId)
assert.deepEqual(recall, [
	'0004xxxx000200060000000a000000121453010060001007012b',
	'0004xxxx00020005000000080000000f008e000060001007',
])

const trigger = buildPbusTrigger(24, 12).map(maskMessageId)
assert.deepEqual(trigger, [
	'0004xxxx000200060000000900000011118805003c0010c700',
	'0004xxxx000200060000000900000011118805003c0010c701',
	'0004xxxx00020005000000080000000f000200003c001007',
])

assert.equal(
	maskMessageId(buildButtonMapping('program', 4, 35, 809)),
	'0004xxxx000200060000000a00000012138501008908c0300329',
)

console.log('16 legacy raw-action vectors passed')
