// Byte-equivalence test: proves new buildSetParam/buildSetEvent builders produce
// identical wire output to the old hex-string templates for every ported command.
// Run after build: node test/test-builders.cjs

const path = require('path')
const fs = require('fs')

const HandshakeConnection = require('../dist/protocol/handshake-connection-class.cjs')

const h = new HandshakeConnection(
	'test',
	'127.0.0.1',
	'suite1a',
	{ mainPort: 6130, listenerPort: 6131 },
	'Test',
	'0.0.0.0',
	'Jan  1 1970',
)
const FIXED_SEQ = 0x1234
h.generateUniqueAuxId = () => FIXED_SEQ

const seqHex = FIXED_SEQ.toString(16).padStart(4, '0')
let pass = 0,
	fail = 0

function assertEqual(name, actual, expectedHex) {
	const expected = Buffer.from(expectedHex, 'hex')
	if (actual.equals(expected)) {
		pass++
	} else {
		console.log(`  FAIL: ${name}`)
		console.log(`    expected: ${expected.toString('hex')}`)
		console.log(`    actual:   ${actual.toString('hex')}`)
		fail++
	}
}

function assertLength(name, buf, len) {
	if (buf.length === len) {
		pass++
	} else {
		console.log(`  FAIL: ${name} length: expected ${len}, got ${buf.length}`)
		fail++
	}
}

function assertValue(name, actual, expected) {
	if (actual === expected) pass++
	else {
		console.log(`  FAIL: ${name}: expected ${expected}, got ${actual}`)
		fail++
	}
}

// ─── Existing tests ──────────────────────────────────────────

console.log('Macro Play (EID 0x0002):')
const macroNum = 42,
	macroIdNum = 0x0a
const macroData = Buffer.alloc(4)
macroData.writeUInt16BE(macroNum - 1, 0)
const macroResult = h.buildSetEvent(0x0002, 0x77000000, macroData, 0x0300 | macroIdNum)
assertEqual(
	'macro play',
	macroResult,
	`000403${macroIdNum.toString(16).padStart(2, '0')}000200050000000c000000130002000077000000${(macroNum - 1).toString(16).padStart(4, '0')}0000`,
)

console.log('Macro Continue (EID 0x0042):')
const contResult = h.buildSetEvent(0x0042, 0x77000000, macroData, 0x0300 | macroIdNum)
assertEqual(
	'macro continue',
	contResult,
	`000403${macroIdNum.toString(16).padStart(2, '0')}000200050000000c000000130042000077000000${(macroNum - 1).toString(16).padStart(4, '0')}0000`,
)

console.log('Macro Stop (EID 0x0003):')
const stopResult = h.buildSetEvent(0x0003, 0x77000000, macroData, 0x0300 | macroIdNum)
assertEqual(
	'macro stop',
	stopResult,
	`000403${macroIdNum.toString(16).padStart(2, '0')}000200050000000c000000130003000077000000${(macroNum - 1).toString(16).padStart(4, '0')}0000`,
)

console.log('Macro Stop-All (EID 0x0003, all-macros sentinel):')
const stopAllResult = h.buildSetEvent(0x0003, 0x77000000, Buffer.from([0xff, 0xff, 0xff, 0xff]))
assertLength('stop-all length', stopAllResult, 28)
assertEqual('stop-all', stopAllResult, `0004${seqHex}000200050000000c000000130003000077000000ffffffff`)

console.log('Aux Route (cut, aux=5, src=100):')
const auxNum = 5,
	sourceNum = 100
const auxData = Buffer.alloc(4)
auxData.writeUInt16BE(sourceNum, 0)
auxData[2] = 0x00
auxData[3] = 0x01
const auxResult = h.buildSetEvent(0x007e, 0x19000100 + (auxNum - 1), auxData)
assertEqual(
	'aux route cut',
	auxResult,
	`0004${seqHex}000200050000000c00000013007e00001900010${(auxNum - 1).toString(16)}${sourceNum.toString(16).padStart(4, '0')}0001`,
)

console.log('Aux Route (mix):')
const auxMixData = Buffer.alloc(4)
auxMixData.writeUInt16BE(sourceNum, 0)
auxMixData[2] = 0x01
auxMixData[3] = 0x01
const auxMixResult = h.buildSetEvent(0x007e, 0x19000100 + (auxNum - 1), auxMixData)
assertEqual(
	'aux route mix',
	auxMixResult,
	`0004${seqHex}000200050000000c00000013007e00001900010${(auxNum - 1).toString(16)}${sourceNum.toString(16).padStart(4, '0')}0101`,
)

console.log('Aux Route (wipe):')
const auxWipeData = Buffer.alloc(4)
auxWipeData.writeUInt16BE(sourceNum, 0)
auxWipeData[2] = 0x02
auxWipeData[3] = 0x01
const auxWipeResult = h.buildSetEvent(0x007e, 0x19000100 + (auxNum - 1), auxWipeData)
assertEqual(
	'aux route wipe',
	auxWipeResult,
	`0004${seqHex}000200050000000c00000013007e00001900010${(auxNum - 1).toString(16)}${sourceNum.toString(16).padStart(4, '0')}0201`,
)

console.log('E-MEM Master (reg=42):')
const eMemMasterData = Buffer.alloc(7)
eMemMasterData.writeUInt16BE(42, 4)
const eMemMasterResult = h.buildSetEvent(0x0041, 0x35000001, eMemMasterData)
assertEqual(
	'emem master',
	eMemMasterResult,
	`0004${seqHex}000200050000000f0000001600410000350000010000000000${(42).toString(16).padStart(2, '0')}00`,
)

console.log('Image Store (out=3, img=1500):')
const imgData = Buffer.alloc(4)
imgData.writeUInt32BE(1500, 0)
const imgResult = h.buildSetParam(0x1730, 0x0400, 0x43000013, imgData)
assertEqual(
	'image store',
	imgResult,
	`0004${seqHex}000200060000000c0000001417300400430000130000${(1500).toString(16).padStart(4, '0')}`,
)

console.log('Image Store Input (input=200):')
const inpData = Buffer.alloc(2)
inpData.writeUInt16BE(200, 0)
const inpResult = h.buildSetParam(0x104a, 0x0100, 0x8c001601, inpData)
assertEqual('image store input', inpResult, `0004${seqHex}000200060000000a00000012104a01008c00160100c8`)

console.log('Panel Memory (reg=50):')
const pmData = Buffer.alloc(2)
pmData.writeUInt16BE(50, 0)
const pmResult = h.buildSetParam(0x14d2, 0x0300, 0x22000000, pmData)
assertEqual(
	'panel memory',
	pmResult,
	`0004${seqHex}000200060000000a0000001214d2030022000000${(50).toString(16).padStart(4, '0')}`,
)

console.log('Timeline edit/navigation:')
const timelineDid = 0x35000001
assertEqual(
	'run master',
	h.buildSetEvent(0x0002, timelineDid, Buffer.alloc(0)),
	`0004${seqHex}00020005000000080000000f0002000035000001`,
)
for (const [partition, mode] of [
	['primary', 0],
	['secondary', 1],
	['both', 2],
]) {
	assertEqual(
		`run ME1 ${partition}`,
		h.buildSetEvent(0x0002, 0x02000000, Buffer.from([mode])),
		`0004${seqHex}0002000500000009000000100002000002000000${mode.toString(16).padStart(2, '0')}`,
	)
}
const timelineVectors = [
	['previous', 0x006b, [0x01, 0xff, 0xff], '0000000b00000012006b00003500000101ffff'],
	['next', 0x006b, [0x01, 0x00, 0x01], '0000000b00000012006b000035000001010001'],
	['insert before', 0x006c, [0x00], '0000000900000010006c00003500000100'],
	['insert after', 0x006c, [0x01], '0000000900000010006c00003500000101'],
	['go beginning', 0x006b, [0x04], '0000000900000010006b00003500000104'],
	['go end', 0x006b, [0x05], '0000000900000010006b00003500000105'],
	['mod', 0x006d, [0x00], '0000000900000010006d00003500000100'],
	['mod all', 0x006d, [0x01], '0000000900000010006d00003500000101'],
	['mod all absolute', 0x006d, [0x02], '0000000900000010006d00003500000102'],
]
for (const [name, eid, data, tail] of timelineVectors) {
	assertEqual(name, h.buildSetEvent(eid, timelineDid, Buffer.from(data)), `0004${seqHex}00020005${tail}`)
}

console.log('Timeline telemetry subscription and parser:')
h.subscriptionSequence = FIXED_SEQ
const timelineSubId = 0x5300
const timelineSubscription = h.buildParameterSubscriptionPacket(5904, 0x35000001, timelineSubId).packet
assertEqual(
	'timeline cursor scalar subscription',
	timelineSubscription,
	`0004${seqHex}00020008000000240000002e000000000000000000000000000000005300000100030003000000001710000035000001`,
)
const timelineIssue = Buffer.alloc(24)
timelineIssue.writeUInt16BE(timelineSubId, 0)
timelineIssue.writeUInt16BE(1, 2)
timelineIssue.writeUInt16BE(3, 4)
timelineIssue.writeUInt16BE(5904, 8)
timelineIssue.writeUInt32BE(0x35000001, 12)
timelineIssue.writeUInt16BE(4, 16)
timelineIssue.writeUInt16BE(5, 18)
timelineIssue.writeFloatBE(12.5, 20)
h.timelineSubscriptionIds.set(timelineSubId, { pid: 5904, key: 'cursorTime' })
assertValue('timeline cursor response parsed', h.parseTimelineParameterResponse(timelineIssue, 0, 24), true)
assertValue('timeline cursor float state', h.getTimelineState().cursorTime, 12.5)
const keyframeSubId = 0x5301
assertEqual(
	'timeline projected-keyframe list subscription',
	h.buildListSubscriptionPacket(4, 0x35000001, keyframeSubId).packet,
	`0004123500020008000000240000002e000000000000000000000000000000005301000100040002000000000004000135000001`,
)
const keyframeIssue = Buffer.alloc(34)
keyframeIssue.writeUInt16BE(keyframeSubId, 0)
keyframeIssue.writeUInt16BE(1, 2)
keyframeIssue.writeUInt16BE(4, 4)
keyframeIssue.writeUInt16BE(1, 6)
keyframeIssue.writeUInt16BE(4, 8)
keyframeIssue.writeUInt16BE(1, 10)
keyframeIssue.writeUInt32BE(0x35000001, 12)
keyframeIssue.writeUInt32BE(0x1234, 16)
keyframeIssue.writeUInt32BE(0, 20)
keyframeIssue.writeUInt16BE(1, 24)
keyframeIssue.writeUInt16BE(6, 26)
keyframeIssue.writeFloatBE(18.25, 28)
keyframeIssue[32] = 1
h.timelineKeyframeSubscriptionId = keyframeSubId
assertValue('timeline pause-point list response parsed', h.parseTimelineKeyframeResponse(keyframeIssue, 0, 34), true)
assertValue('timeline pause-point time state', h.getTimelineState().pausePoints[0], 18.25)
const imageStoreSubId = 0x5302
const imageStoreIssue = Buffer.alloc(24)
imageStoreIssue.writeUInt16BE(imageStoreSubId, 0)
imageStoreIssue.writeUInt16BE(1, 2)
imageStoreIssue.writeUInt16BE(3, 4)
imageStoreIssue.writeUInt16BE(5936, 8)
imageStoreIssue.writeUInt32BE(0x43000013, 12)
imageStoreIssue.writeUInt16BE(4, 16)
imageStoreIssue.writeUInt16BE(3, 18)
imageStoreIssue.writeUInt32BE(1500, 20)
h.imageStoreSubscriptionIds.set(imageStoreSubId, 3)
assertValue(
	'image-store display-image response parsed',
	h.parseImageStoreParameterResponse(imageStoreIssue, 0, 24),
	true,
)
assertValue('image-store output state', h.getImageStoreImage(3), 1500)

const transitionDid = 0x03000000
const rampSubId = 0x5303
const activeSubId = 0x5304
h.transitionSubscriptionIds.set(rampSubId, { did: transitionDid, pid: 4454 })
h.transitionSubscriptionIds.set(activeSubId, { did: transitionDid, pid: 4459 })
const transitionIssue = (subId, pid, size = 24) => {
	const issue = Buffer.alloc(size)
	issue.writeUInt16BE(subId, 0)
	issue.writeUInt16BE(1, 2)
	issue.writeUInt16BE(3, 4)
	issue.writeUInt16BE(pid, 8)
	issue.writeUInt32BE(transitionDid, 12)
	return issue
}
const activeIssue = transitionIssue(activeSubId, 4459, 21)
activeIssue[20] = 1
assertValue('auto-transition active response parsed', h.parseTransitionTelemetryResponse(activeIssue, 0, 21), true)
const rampIssue = transitionIssue(rampSubId, 4454)
rampIssue.writeFloatBE(0.4, 20)
assertValue('auto-transition ramp response parsed', h.parseTransitionTelemetryResponse(rampIssue, 0, 24), true)
assertValue('auto-transition active state', h.getTransitionTelemetry(transitionDid).active, true)
assertValue('auto-transition ramp state', Math.round(h.getTransitionTelemetry(transitionDid).ramp * 10), 4)
assertValue('auto-transition direction state', h.getTransitionTelemetry(transitionDid).direction, 'up')

// ─── B1: All 50 crosspoint targets ──────────────────────────

console.log('\nCrosspoint targets (50 entries):')

const OLD_HEX_TEMPLATES = {
	PGM_A: '0004129a000200060000000a00000012104a010004000003',
	PGM_B: '0004129d000200060000000a00000012104a010004000013',
	PGM_C: '000412bf000200060000000a00000012104a010004000023',
	PGM_D: '000412c2000200060000000a00000012104a010004000033',
	PGM_K1: '0004052d000200060000000a00000012103a010008000003',
	PGM_K2: '0004052e000200060000000a00000012103a010008000013',
	PGM_K3: '0004052f000200060000000a00000012103a010008000023',
	PGM_K4: '00040530000200060000000a00000012103a010008000033',
	PGM_K5: '00040532000200060000000a00000012103a010008000043',
	PGM_K6: '00040533000200060000000a00000012103a010008000053',
	ME1_A: '000412a0000200060000000a00000012104a010004000000',
	ME1_B: '000412a3000200060000000a00000012104a010004000010',
	ME1_C: '000412c5000200060000000a00000012104a010004000020',
	ME1_D: '000412c8000200060000000a00000012104a010004000030',
	ME1_K1: '00040534000200060000000a00000012103a010008000000',
	ME1_K2: '00040535000200060000000a00000012103a010008000010',
	ME1_K3: '00040536000200060000000a00000012103a010008000020',
	ME1_K4: '00040537000200060000000a00000012103a010008000030',
	ME1_K5: '00040538000200060000000a00000012103a010008000040',
	ME1_K6: '00040539000200060000000a00000012103a010008000050',
	ME2_A: '000412a6000200060000000a00000012104a010004000001',
	ME2_B: '000412a9000200060000000a00000012104a010004000011',
	ME2_C: '000412cb000200060000000a00000012104a010004000021',
	ME2_D: '000412ce000200060000000a00000012104a010004000031',
	ME2_K1: '0004053a000200060000000a00000012103a010008000001',
	ME2_K2: '0004053b000200060000000a00000012103a010008000011',
	ME2_K3: '0004053c000200060000000a00000012103a010008000021',
	ME2_K4: '0004053d000200060000000a00000012103a010008000031',
	ME2_K5: '0004053e000200060000000a00000012103a010008000041',
	ME2_K6: '0004053f000200060000000a00000012103a010008000051',
	ME3_A: '000412ac000200060000000a00000012104a010004000002',
	ME3_B: '000412af000200060000000a00000012104a010004000012',
	ME3_C: '000412d1000200060000000a00000012104a010004000022',
	ME3_D: '000412d4000200060000000a00000012104a010004000032',
	ME3_K1: '00040542000200060000000a00000012103a010008000002',
	ME3_K2: '00040543000200060000000a00000012103a010008000012',
	ME3_K3: '00040544000200060000000a00000012103a010008000022',
	ME3_K4: '00040545000200060000000a00000012103a010008000032',
	ME3_K5: '00040546000200060000000a00000012103a010008000042',
	ME3_K6: '00040540000200060000000a00000012103a010008000052',
	ME4_A: '000412b9000200060000000a00000012104a010004000004',
	ME4_B: '000412bc000200060000000a00000012104a010004000014',
	ME4_C: '000412d7000200060000000a00000012104a010004000024',
	ME4_D: '000412da000200060000000a00000012104a010004000034',
	ME4_K1: '00040547000200060000000a00000012103a010008000004',
	ME4_K2: '00040548000200060000000a00000012103a010008000014',
	ME4_K3: '00040549000200060000000a00000012103a010008000024',
	ME4_K4: '0004054a000200060000000a00000012103a010008000034',
	ME4_K5: '0004054b000200060000000a00000012103a010008000044',
	ME4_K6: '0004054c000200060000000a00000012103a010008000054',
}

const XPT_TARGETS = {
	PGM_A: { pid: 0x104a, did: 0x04000003 },
	PGM_B: { pid: 0x104a, did: 0x04000013 },
	PGM_C: { pid: 0x104a, did: 0x04000023 },
	PGM_D: { pid: 0x104a, did: 0x04000033 },
	PGM_K1: { pid: 0x103a, did: 0x08000003 },
	PGM_K2: { pid: 0x103a, did: 0x08000013 },
	PGM_K3: { pid: 0x103a, did: 0x08000023 },
	PGM_K4: { pid: 0x103a, did: 0x08000033 },
	PGM_K5: { pid: 0x103a, did: 0x08000043 },
	PGM_K6: { pid: 0x103a, did: 0x08000053 },
	ME1_A: { pid: 0x104a, did: 0x04000000 },
	ME1_B: { pid: 0x104a, did: 0x04000010 },
	ME1_C: { pid: 0x104a, did: 0x04000020 },
	ME1_D: { pid: 0x104a, did: 0x04000030 },
	ME1_K1: { pid: 0x103a, did: 0x08000000 },
	ME1_K2: { pid: 0x103a, did: 0x08000010 },
	ME1_K3: { pid: 0x103a, did: 0x08000020 },
	ME1_K4: { pid: 0x103a, did: 0x08000030 },
	ME1_K5: { pid: 0x103a, did: 0x08000040 },
	ME1_K6: { pid: 0x103a, did: 0x08000050 },
	ME2_A: { pid: 0x104a, did: 0x04000001 },
	ME2_B: { pid: 0x104a, did: 0x04000011 },
	ME2_C: { pid: 0x104a, did: 0x04000021 },
	ME2_D: { pid: 0x104a, did: 0x04000031 },
	ME2_K1: { pid: 0x103a, did: 0x08000001 },
	ME2_K2: { pid: 0x103a, did: 0x08000011 },
	ME2_K3: { pid: 0x103a, did: 0x08000021 },
	ME2_K4: { pid: 0x103a, did: 0x08000031 },
	ME2_K5: { pid: 0x103a, did: 0x08000041 },
	ME2_K6: { pid: 0x103a, did: 0x08000051 },
	ME3_A: { pid: 0x104a, did: 0x04000002 },
	ME3_B: { pid: 0x104a, did: 0x04000012 },
	ME3_C: { pid: 0x104a, did: 0x04000022 },
	ME3_D: { pid: 0x104a, did: 0x04000032 },
	ME3_K1: { pid: 0x103a, did: 0x08000002 },
	ME3_K2: { pid: 0x103a, did: 0x08000012 },
	ME3_K3: { pid: 0x103a, did: 0x08000022 },
	ME3_K4: { pid: 0x103a, did: 0x08000032 },
	ME3_K5: { pid: 0x103a, did: 0x08000042 },
	ME3_K6: { pid: 0x103a, did: 0x08000052 },
	ME4_A: { pid: 0x104a, did: 0x04000004 },
	ME4_B: { pid: 0x104a, did: 0x04000014 },
	ME4_C: { pid: 0x104a, did: 0x04000024 },
	ME4_D: { pid: 0x104a, did: 0x04000034 },
	ME4_K1: { pid: 0x103a, did: 0x08000004 },
	ME4_K2: { pid: 0x103a, did: 0x08000014 },
	ME4_K3: { pid: 0x103a, did: 0x08000024 },
	ME4_K4: { pid: 0x103a, did: 0x08000034 },
	ME4_K5: { pid: 0x103a, did: 0x08000044 },
	ME4_K6: { pid: 0x103a, did: 0x08000054 },
}

for (const [name, t] of Object.entries(XPT_TARGETS)) {
	const srcBuf = Buffer.alloc(2)
	srcBuf.writeUInt16BE(0x0042, 0)
	const result = h.buildSetParam(t.pid, 0x0100, t.did, srcBuf)
	const oldTemplate = OLD_HEX_TEMPLATES[name]
	const expected = oldTemplate.substring(0, 4) + seqHex + oldTemplate.substring(8) + '0042'
	assertEqual(`xpt ${name} src=0x42`, result, expected)
	assertLength(`xpt ${name} len=26`, result, 26)
}

for (const src of [1, 809]) {
	const srcBuf = Buffer.alloc(2)
	srcBuf.writeUInt16BE(src, 0)
	const result = h.buildSetParam(0x104a, 0x0100, 0x04000000, srcBuf)
	assertLength(`xpt ME1_A src=${src} len=26`, result, 26)
	if (result.readUInt16BE(6) === 0x0006) {
		pass++
	} else {
		console.log(`  FAIL: xpt ME1_A src=${src} cmdWord`)
		fail++
	}
}

// ─── B2: Transition targets × both EIDs (80 vectors) ────────

console.log('\nTransition targets (80 vectors):')

const TRANSITION_DIDS = {
	PGM_PRI: 0x03000003,
	PGM_SEC: 0x03000013,
	ME1_PRI: 0x03000000,
	ME1_SEC: 0x03000010,
	ME2_PRI: 0x03000001,
	ME2_SEC: 0x03000011,
	ME3_PRI: 0x03000002,
	ME3_SEC: 0x03000012,
	ME4_PRI: 0x03000004,
	ME4_SEC: 0x03000014,
}

const KEYER_DIDS = {
	PGM_KEY1: 0x08000003,
	PGM_KEY2: 0x08000013,
	PGM_KEY3: 0x08000023,
	PGM_KEY4: 0x08000033,
	PGM_KEY5: 0x08000043,
	PGM_KEY6: 0x08000053,
	ME1_KEY1: 0x08000000,
	ME1_KEY2: 0x08000010,
	ME1_KEY3: 0x08000020,
	ME1_KEY4: 0x08000030,
	ME1_KEY5: 0x08000040,
	ME1_KEY6: 0x08000050,
	ME2_KEY1: 0x08000001,
	ME2_KEY2: 0x08000011,
	ME2_KEY3: 0x08000021,
	ME2_KEY4: 0x08000031,
	ME2_KEY5: 0x08000041,
	ME2_KEY6: 0x08000051,
	ME3_KEY1: 0x08000002,
	ME3_KEY2: 0x08000012,
	ME3_KEY3: 0x08000022,
	ME3_KEY4: 0x08000032,
	ME3_KEY5: 0x08000042,
	ME3_KEY6: 0x08000052,
	ME4_KEY1: 0x08000004,
	ME4_KEY2: 0x08000014,
	ME4_KEY3: 0x08000024,
	ME4_KEY4: 0x08000034,
	ME4_KEY5: 0x08000044,
	ME4_KEY6: 0x08000054,
}

const OLD_TRANS_ENDINGS = {
	PGM_PRI: '000003',
	PGM_SEC: '000013',
	ME1_PRI: '000000',
	ME1_SEC: '000010',
	ME2_PRI: '000001',
	ME2_SEC: '000011',
	ME3_PRI: '000002',
	ME3_SEC: '000012',
	ME4_PRI: '000004',
	ME4_SEC: '000014',
}

const OLD_KEYER_ENDINGS = {
	PGM_KEY1: '000003',
	PGM_KEY2: '000013',
	PGM_KEY3: '000023',
	PGM_KEY4: '000033',
	PGM_KEY5: '000043',
	PGM_KEY6: '000053',
	ME1_KEY1: '000000',
	ME1_KEY2: '000010',
	ME1_KEY3: '000020',
	ME1_KEY4: '000030',
	ME1_KEY5: '000040',
	ME1_KEY6: '000050',
	ME2_KEY1: '000001',
	ME2_KEY2: '000011',
	ME2_KEY3: '000021',
	ME2_KEY4: '000031',
	ME2_KEY5: '000041',
	ME2_KEY6: '000051',
	ME3_KEY1: '000002',
	ME3_KEY2: '000012',
	ME3_KEY3: '000022',
	ME3_KEY4: '000032',
	ME3_KEY5: '000042',
	ME3_KEY6: '000052',
	ME4_KEY1: '000004',
	ME4_KEY2: '000014',
	ME4_KEY3: '000024',
	ME4_KEY4: '000034',
	ME4_KEY5: '000044',
	ME4_KEY6: '000054',
}

for (const [name, did] of Object.entries(TRANSITION_DIDS)) {
	for (const [eid, cmdCode] of [
		[0x0044, '44'],
		[0x0043, '43'],
	]) {
		const result = h.buildSetEvent(eid, did)
		const oldHex = `0004${seqHex}00020005000000080000000f00${cmdCode}000003${OLD_TRANS_ENDINGS[name]}`
		assertEqual(`trans ${name} eid=0x${eid.toString(16)}`, result, oldHex)
		assertLength(`trans ${name} len=24`, result, 24)
	}
}

for (const [name, did] of Object.entries(KEYER_DIDS)) {
	for (const [eid, cmdCode] of [
		[0x0044, '44'],
		[0x0043, '43'],
	]) {
		const result = h.buildSetEvent(eid, did)
		const oldHex = `0004${seqHex}00020005000000080000000f00${cmdCode}000008${OLD_KEYER_ENDINGS[name]}`
		assertEqual(`keyer ${name} eid=0x${eid.toString(16)}`, result, oldHex)
		assertLength(`keyer ${name} len=24`, result, 24)
	}
}

// ─── B3: All 18 targeted E-MEM combinations ─────────────────

console.log('\nTargeted E-MEM (18 + endpoints):')

const EMEM_TARGETS = {
	'ME1-PRI': { did: 0x02000000, mode: 0 },
	'ME1-SEC': { did: 0x02000000, mode: 1 },
	'ME1-BOTH': { did: 0x02000000, mode: 2 },
	'ME2-PRI': { did: 0x02000001, mode: 0 },
	'ME2-SEC': { did: 0x02000001, mode: 1 },
	'ME2-BOTH': { did: 0x02000001, mode: 2 },
	'ME3-PRI': { did: 0x02000002, mode: 0 },
	'ME3-SEC': { did: 0x02000002, mode: 1 },
	'ME3-BOTH': { did: 0x02000002, mode: 2 },
	'PGM-PRI': { did: 0x02000003, mode: 0 },
	'PGM-SEC': { did: 0x02000003, mode: 1 },
	'PGM-BOTH': { did: 0x02000003, mode: 2 },
	'ME4-PRI': { did: 0x02000004, mode: 0 },
	'ME4-SEC': { did: 0x02000004, mode: 1 },
	'ME4-BOTH': { did: 0x02000004, mode: 2 },
	'eDPM-PRI': { did: 0x0200000a, mode: 0 },
	'eDPM-SEC': { did: 0x0200000a, mode: 1 },
	'eDPM-BOTH': { did: 0x0200000a, mode: 2 },
}

const OLD_EMEM_TEMPLATES = {
	'ME1-PRI': '0004{message_id}000200050000001000000017004100000200000000000000{emem_hex}0000',
	'ME1-SEC': '0004{message_id}000200050000001000000017004100000200000000000000{emem_hex}0001',
	'ME1-BOTH': '0004{message_id}000200050000001000000017004100000200000000000000{emem_hex}0002',
	'ME2-PRI': '0004{message_id}000200050000001000000017004100000200000100000000{emem_hex}0000',
	'ME2-SEC': '0004{message_id}000200050000001000000017004100000200000100000000{emem_hex}0001',
	'ME2-BOTH': '0004{message_id}000200050000001000000017004100000200000100000000{emem_hex}0002',
	'ME3-PRI': '0004{message_id}000200050000001000000017004100000200000200000000{emem_hex}0000',
	'ME3-SEC': '0004{message_id}000200050000001000000017004100000200000200000000{emem_hex}0001',
	'ME3-BOTH': '0004{message_id}000200050000001000000017004100000200000200000000{emem_hex}0002',
	'ME4-PRI': '0004{message_id}000200050000001000000017004100000200000400000000{emem_hex}0000',
	'ME4-SEC': '0004{message_id}000200050000001000000017004100000200000400000000{emem_hex}0001',
	'ME4-BOTH': '0004{message_id}000200050000001000000017004100000200000400000000{emem_hex}0002',
	'PGM-PRI': '0004{message_id}000200050000001000000017004100000200000300000000{emem_hex}0000',
	'PGM-SEC': '0004{message_id}000200050000001000000017004100000200000300000000{emem_hex}0001',
	'PGM-BOTH': '0004{message_id}000200050000001000000017004100000200000300000000{emem_hex}0002',
	'eDPM-PRI': '0004{message_id}000200050000001000000017004100000200000a00000000{emem_hex}0000',
	'eDPM-SEC': '0004{message_id}000200050000001000000017004100000200000a00000000{emem_hex}0001',
	'eDPM-BOTH': '0004{message_id}000200050000001000000017004100000200000a00000000{emem_hex}0002',
}

const testReg = 42
const regHex = testReg.toString(16).padStart(4, '0')
for (const [name, t] of Object.entries(EMEM_TARGETS)) {
	const data = Buffer.alloc(8)
	data.writeUInt16BE(testReg, 4)
	data.writeUInt16BE(t.mode, 6)
	const result = h.buildSetEvent(0x0041, t.did, data)
	const oldHex = OLD_EMEM_TEMPLATES[name].replace('{message_id}', seqHex).replace('{emem_hex}', regHex)
	assertEqual(`emem targeted ${name} reg=${testReg}`, result, oldHex)
	assertLength(`emem targeted ${name} len=32`, result, 32)
}

for (const reg of [0, 999]) {
	const data = Buffer.alloc(8)
	data.writeUInt16BE(reg, 4)
	data.writeUInt16BE(0, 6)
	const result = h.buildSetEvent(0x0041, 0x02000000, data)
	assertLength(`emem targeted ME1-PRI reg=${reg} len=32`, result, 32)
	if (result.readUInt16BE(16) === 0x0041) {
		pass++
	} else {
		console.log(`  FAIL: emem targeted reg=${reg} eid`)
		fail++
	}
}

const masterData2 = Buffer.alloc(7)
masterData2.writeUInt16BE(testReg, 4)
const masterResult2 = h.buildSetEvent(0x0041, 0x35000001, masterData2)
assertLength('emem master len=31', masterResult2, 31)

// ─── Source file assertions ──────────────────────────────────

console.log('\nSource file assertions:')

const xptSrc = fs.readFileSync(path.join(__dirname, '../src/actions.ts'), 'utf8')
if (!xptSrc.includes('hexTemplates') && xptSrc.includes('sendCrosspoint')) {
	pass++
} else {
	console.log('  FAIL: Companion crosspoint action is not using sendCrosspoint')
	fail++
}

const transSrc = fs.readFileSync(path.join(__dirname, '../src/actions.ts'), 'utf8')
if (
	!transSrc.includes('TRANSITION_HEX_ENDINGS') &&
	!transSrc.includes('KEYER_HEX_ENDINGS') &&
	!transSrc.includes('getNextMessageId') &&
	!transSrc.includes('messageIdCounter')
) {
	pass++
} else {
	console.log('  FAIL: transitionModuleAction.ts still contains old template names')
	fail++
}

const ememSrc = fs.readFileSync(path.join(__dirname, '../src/actions.ts'), 'utf8')
if (!ememSrc.includes('EMEM_TARGET_COMMANDS') && !ememSrc.includes('{message_id}') && !ememSrc.includes('{emem_hex}')) {
	pass++
} else {
	console.log('  FAIL: eMemAction.ts still contains old template names')
	fail++
}

// ─── Summary ─────────────────────────────────────────────────

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
