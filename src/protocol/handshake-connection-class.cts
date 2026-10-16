// Class-based handshake connection - supports multiple simultaneous connections
// Supports both TCP (V16+/V18) and UDP (V14) protocols with auto-detection

import dgram = require('dgram')
import net = require('net')
import EventEmitter = require('events')
import crypto = require('crypto')

/** Result returned by every public command/subscription method. */
interface CommandResult {
	success: boolean
	message: string
}

/** Local ports for the UDP sockets; either may be omitted (defaults 6130/6131, 0 = OS-assigned). */
interface ConnectionPorts {
	mainPort?: number
	listenerPort?: number
}

type TransportProtocol = 'tcp' | 'udp'

/** Completion callback shared by net.Socket#write and dgram.Socket#send. */
type SendCallback = (err?: Error | null) => void

interface FrameInfo {
	version: string | null
	name: string | null
	buildDate: string | null
}

interface MacroCatalogEntry {
	oled: string
	panel: string
	comment: string
}

interface MacroQueueItem {
	macroNum: number
	macroPayload: Buffer
	macroIdNum: number
	eid: number
}

interface MacroRunState {
	macroStatus: Record<number, number>
	lastPlayedMacro: number | null
	runSeq: number
}

/** One decoded entry of a macro status (sub_id 0x0234) push. */
interface MacroStatusEntry {
	index: number
	macroNum: number
	status: number
}

/** Operator (0x020b) and engineering (0x0210) names for one source. */
interface SourceNameEntry {
	oled: string
	short: string
	eng: string
	panel: string
	menu: string
}

type TimelineScalarKey = 'cursorTime' | 'duration' | 'pauseState' | 'runState'

interface TimelineState {
	cursorTime: number | null
	duration: number | null
	pauseState: number
	runState: number | null
	pausePoints: number[]
}

interface TimelineParameterSubscription {
	pid: number
	key: TimelineScalarKey
}

interface TimelineKeyframe {
	time: number
	pause: number
}

interface TransitionTelemetryState {
	ramp: number
	effectiveRate: number
	active: boolean
	direction: 'up' | 'down' | null
}

/** A scalar CPL parameter subscription target. */
interface ParameterTarget {
	did: number
	pid: number
}

interface SubscriptionPacket {
	packet: Buffer
	subId: number
}

/** Message text of a caught value; Error instances keep their own message. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

// V18 TCP session framing constants
const SESSION_HEADER = Buffer.from([0xb9, 0x91, 0x6f, 0x84])
const SESSION_TRAILER = Buffer.from([0x37, 0x62, 0xc5, 0xd9])
const TCP_DETECT_TIMEOUT = 2000 // 2 seconds to detect V18+ frame

/**
 * HandshakeConnection - Manages a single connection to a GV suite
 * Each instance maintains its own sockets, state, and event emitter
 */
class HandshakeConnection {
	connectionId: string
	targetHost: string
	suite: string
	customPorts: ConnectionPorts | null | undefined
	suiteName: string
	moduleVersion: string
	buildDate: string
	clientName: string

	// Connection state
	mainClient: dgram.Socket | null
	listenerClient: dgram.Socket | null
	secondPhaseDynamicCommPort: number
	announcedTargetPort: number
	mainHandshakeStage: number
	isClosing: boolean
	startupAbort: AbortController

	// Timers and intervals
	heartbeatIntervalId: NodeJS.Timeout | null
	packet1RetryIntervalId: NodeJS.Timeout | null
	handshakeOverallTimeoutId: NodeJS.Timeout | null

	// State tracking
	lastHeartbeatResponseTime: number
	missedHeartbeats: number
	lastSentMacroId: number | null
	macroQueue: MacroQueueItem[]
	isSendingMacro: boolean
	fullyConnected: boolean

	// Message ID tracking
	recentlyUsedIds: number[]
	nextMacroId: number
	lastUsedSessionId: number | null
	udpMsgCounter?: number

	// AUX subscription state
	auxState: Map<number, number>
	subscribedAuxes: Set<string>
	nextSubscriptionId: number
	subscriptionSequence: number

	// ME bus subscription state
	keyerState: Map<number, number>
	meState: Map<number, number>
	subscribedMEs: Set<string>

	// Master E-MEM timeline
	timelineState: TimelineState
	timelineSubscriptionIds: Map<number, TimelineParameterSubscription>
	timelineKeyframeSubscriptionId: number | null
	timelineKeyframes: Map<number, TimelineKeyframe>
	timelineSubscribed: boolean

	// Image Store
	imageStoreState: Map<number, number>
	imageStoreSubscriptionIds: Map<number, number>
	imageStoreSubscribed: boolean

	// Transition telemetry
	transitionTelemetry: Map<number, TransitionTelemetryState>
	transitionSubscriptionIds: Map<number, ParameterTarget>
	transitionTelemetrySubscribed: boolean

	// Source names
	sourceNames: Map<number, SourceNameEntry>
	sourceNamesSubscribed: boolean

	// TCP state (V16+/V18)
	protocol: TransportProtocol
	tcpSocket: net.Socket | null
	tcpBuffer: Buffer
	tcpAuthPayload?: Buffer | null
	lastTcpDataTime: number
	tcpHeartbeatCheckId: NodeJS.Timeout | null
	tcpActiveHeartbeatId: NodeJS.Timeout | null
	frameVersion: string | null
	frameName: string | null
	frameBuildDate: string | null

	// Macro catalog state
	macroCatalog: Map<number, MacroCatalogEntry>
	macroCatalogReady: boolean
	lastPublishedMacroCatalog: string | null
	macroCatalogBulkTimerId: NodeJS.Timeout | null
	macroCatalogSubscribed: boolean
	macroCatalogDataSeen: boolean
	macroCatalogRetryTimerId: NodeJS.Timeout | null
	macroCatalogSubscribeAttempts: number

	// Macro run-state
	macroStatus: Map<number, number>
	lastPlayedMacro: number | null
	runSeq: number
	macroStatusSubscribed: boolean

	emitter: EventEmitter

	// Configuration
	mainClientPort: number
	listenerClientPort: number
	initialServerPort: number
	portAnnounceServerPort: number
	heartbeatIntervalMs: number
	handshakeTimeoutMs: number
	MAX_MISSED_HEARTBEATS: number
	MAX_TRACKED_IDS: number
	macroSendDelayMs: number
	MAX_MACRO_SUBSCRIBE_ATTEMPTS: number
	MACRO_SUBSCRIBE_RETRY_MS: number

	// Payloads: assigned by setupPayloads()/setupSuiteCommands(), which the constructor calls.
	payloadPacket1!: Buffer
	expectedPayloadPacket2!: Buffer
	payloadPacket3!: Buffer
	expectedPayloadPacket4!: Buffer
	payloadPacket5!: Buffer
	expectedPayloadPacket6!: Buffer
	expectedPayloadPacket7!: Buffer
	payloadPacket8!: Buffer
	expectedPayloadPacket10!: Buffer
	payloadPacket12!: Buffer
	expectedPayloadPacket13!: Buffer
	payloadPacket14!: Buffer
	expectedPayloadPacket15!: Buffer
	payloadPacket16Base!: Buffer
	payloadPacket16Client!: Buffer
	expectedPayloadPacket17!: Buffer
	clientHeartbeatPayload!: Buffer
	expectedServerHeartbeatResponse!: Buffer
	suiteCommands!: Record<string, Buffer[]>

	constructor(
		connectionId: string,
		targetHost: string,
		suite: string,
		customPorts?: ConnectionPorts | null,
		suiteName?: string,
		moduleVersion?: string,
		buildDate?: string,
	) {
		this.connectionId = connectionId
		this.targetHost = targetHost
		this.suite = suite
		this.customPorts = customPorts
		this.suiteName = suiteName || 'Unknown'
		this.moduleVersion = moduleVersion || '0.0.0.0'
		this.buildDate = buildDate || 'Jan  1 1970'
		this.clientName = `Companion - ${this.suiteName}`

		// Connection state
		this.mainClient = null
		this.listenerClient = null
		this.secondPhaseDynamicCommPort = 0
		this.announcedTargetPort = 0
		this.mainHandshakeStage = 1
		this.isClosing = false
		this.startupAbort = new AbortController()

		// Timers and intervals
		this.heartbeatIntervalId = null
		this.packet1RetryIntervalId = null
		this.handshakeOverallTimeoutId = null

		// State tracking
		this.lastHeartbeatResponseTime = 0
		this.missedHeartbeats = 0
		this.lastSentMacroId = null
		this.macroQueue = []
		this.isSendingMacro = false
		this.fullyConnected = false // Only true after CONNECTED event (2 sec stable heartbeat)

		// Message ID tracking
		this.recentlyUsedIds = []
		this.nextMacroId = 0
		this.lastUsedSessionId = null

		// AUX subscription state
		this.auxState = new Map() // auxNum (1-96) -> currentSourceNum
		this.subscribedAuxes = new Set() // Set of auxNum we've subscribed to
		this.nextSubscriptionId = 0x0400 // Starting subscription ID range
		this.subscriptionSequence = 0x0300 // Sequence counter for subscription packets

		// ME bus subscription state
		this.keyerState = new Map() // Keyer source selections; separate from A-D bus state.
		this.meState = new Map() // address byte -> currentSourceNum
		this.subscribedMEs = new Set() // Tracking set (like subscribedAuxes)

		// Master E-MEM timeline scalar subscriptions
		this.timelineState = { cursorTime: null, duration: null, pauseState: 0, runState: null, pausePoints: [] }
		this.timelineSubscriptionIds = new Map() // subscriptionId -> { pid, key }
		this.timelineKeyframeSubscriptionId = null
		this.timelineKeyframes = new Map() // item handle -> { time, pause }
		this.timelineSubscribed = false

		// Image Store display-image subscriptions (output 1-10)
		this.imageStoreState = new Map()
		this.imageStoreSubscriptionIds = new Map() // subscriptionId -> output
		this.imageStoreSubscribed = false

		// Auto-transition telemetry for each ME/PGM primary and secondary partition.
		this.transitionTelemetry = new Map() // DID -> { ramp, effectiveRate, active, direction }
		this.transitionSubscriptionIds = new Map() // subscriptionId -> { did, pid }
		this.transitionTelemetrySubscribed = false

		// Source name state (0x020b + 0x0210 subscriptions)
		this.sourceNames = new Map() // sourceId (number) -> { oled, short, eng, panel, menu }
		this.sourceNamesSubscribed = false

		// TCP state (V16+/V18)
		this.protocol = 'udp' // 'tcp' or 'udp' - set during start()
		this.tcpSocket = null
		this.tcpBuffer = Buffer.alloc(0)
		this.lastTcpDataTime = 0
		this.tcpHeartbeatCheckId = null
		this.tcpActiveHeartbeatId = null
		this.frameVersion = null // e.g., "V18.0.0"
		this.frameName = null // e.g., "Frame Facility Interface"
		this.frameBuildDate = null

		// Macro catalog state (TCP/V16+ only)
		this.macroCatalog = new Map() // macroNumber (1-999) -> { oled, panel, comment }
		this.macroCatalogReady = false // True after bulk load complete
		this.lastPublishedMacroCatalog = null
		this.macroCatalogBulkTimerId = null // Timer for detecting bulk load completion
		this.macroCatalogSubscribed = false // Whether we've sent the subscribe packet
		this.macroCatalogDataSeen = false // Set true after first valid macro data arrives
		this.macroCatalogRetryTimerId = null // Retry timer for dropped initial subscribe
		this.macroCatalogSubscribeAttempts = 0

		// Macro run-state (status subscription sub_id 0x0234)
		this.macroStatus = new Map() // macroNumber (1-999) -> eMacroStatus (1=Playing, 7=Paused)
		this.lastPlayedMacro = null // macro number most recently played (not continued)
		this.runSeq = 0 // bumped on any macroStatus or lastPlayedMacro change
		this.macroStatusSubscribed = false
		// (_optimisticPlayTimer / _optimisticPlayMacro removed — the frame is
		// the sole source of truth for Playing/Paused state; see afterMacroFire)

		// Event emitter for this connection
		this.emitter = new EventEmitter()

		// Configuration
		this.mainClientPort = customPorts?.mainPort ?? 6130 // 0 = OS-assigned (tests)
		this.listenerClientPort = customPorts?.listenerPort ?? 6131
		this.initialServerPort = 5000
		this.portAnnounceServerPort = 5001
		this.heartbeatIntervalMs = 1000
		this.handshakeTimeoutMs = 10000
		this.MAX_MISSED_HEARTBEATS = 5
		this.MAX_TRACKED_IDS = 50
		this.macroSendDelayMs = 50
		this.MAX_MACRO_SUBSCRIBE_ATTEMPTS = 8
		this.MACRO_SUBSCRIBE_RETRY_MS = 1500

		// Payloads (same as original)
		this.setupPayloads()
		this.setupSuiteCommands()
	}

	setupPayloads(): void {
		// Handshake 1 payloads
		this.payloadPacket1 = Buffer.from([0x00, 0x06, 0x00, 0x00])
		this.expectedPayloadPacket2 = Buffer.from([0x00, 0x02, 0x00, 0x00])
		this.payloadPacket3 = Buffer.from([0x00, 0x01, 0x00, 0x00])
		this.expectedPayloadPacket4 = Buffer.from([0x00, 0x02, 0x00, 0x00])
		const nameBytes = Buffer.from(`${this.clientName}\x00`, 'ascii')
		const authOuterLen = 4 + nameBytes.length // seq(2) + clientId(2) + name
		const packet5Header = Buffer.alloc(20)
		packet5Header.writeUInt16BE(0x0004, 0)
		packet5Header.writeUInt16BE(0x0001, 2)
		packet5Header.writeUInt16BE(0x0002, 4)
		packet5Header.writeUInt16BE(0x001f, 6)
		packet5Header.writeUInt32BE(authOuterLen, 8)
		packet5Header.writeUInt32BE(0x0000002c, 12)
		packet5Header.writeUInt16BE(0x0001, 16)
		packet5Header.writeUInt16BE(0x0000, 18)
		this.payloadPacket5 = Buffer.concat([packet5Header, nameBytes])
		this.expectedPayloadPacket6 = Buffer.from([0x00, 0x02, 0x00, 0x01])

		// Listener Channel payloads
		this.expectedPayloadPacket7 = Buffer.from([0x00, 0x01, 0x00, 0x00])
		this.payloadPacket8 = Buffer.from([0x00, 0x02, 0x00, 0x00])
		this.expectedPayloadPacket10 = Buffer.from([0x00, 0x02, 0x00, 0x01])

		// Handshake 2 payloads
		this.payloadPacket12 = Buffer.from([0x00, 0x06, 0x00, 0x00])
		this.expectedPayloadPacket13 = Buffer.from([0x00, 0x02, 0x00, 0x00])
		this.payloadPacket14 = Buffer.from([0x00, 0x01, 0x00, 0x00])
		this.expectedPayloadPacket15 = Buffer.from([0x00, 0x02, 0x00, 0x00])
		const packet16Base = Buffer.alloc(16)
		packet16Base.writeUInt16BE(0x0004, 0)
		packet16Base.writeUInt16BE(0x0001, 2)
		packet16Base.writeUInt16BE(0x0002, 4)
		packet16Base.writeUInt16BE(0x001f, 6)
		packet16Base.writeUInt32BE(authOuterLen, 8)
		packet16Base.writeUInt32BE(0x0000002c, 12)
		this.payloadPacket16Base = packet16Base
		this.payloadPacket16Client = Buffer.from(`${this.clientName}\x00`, 'ascii')
		this.expectedPayloadPacket17 = Buffer.from([0x00, 0x02, 0x00, 0x01])

		// Heartbeat payloads
		this.clientHeartbeatPayload = Buffer.from([0x00, 0x01, 0x00, 0x00])
		this.expectedServerHeartbeatResponse = Buffer.from([0x00, 0x02, 0x00, 0x00])
	}

	setupSuiteCommands(): void {
		this.suiteCommands = {
			suite1a: [
				Buffer.from('0004017c000200060000000c0000001417960200010000070000000a', 'hex'),
				Buffer.from('000407a700020005000000090000001004b600000100000700', 'hex'),
			],
			suite2a: [
				Buffer.from('0004017a000200060000000c0000001417960200010000070000000c', 'hex'),
				Buffer.from('000407a700020005000000090000001004b600000100000700', 'hex'),
			],
			suite3a: [
				Buffer.from('0004017e000200060000000c0000001417960200010000070000000e', 'hex'),
				Buffer.from('000407ab00020005000000090000001004b600000100000700', 'hex'),
			],
			suite4a: [
				Buffer.from('000401f7000200060000000c00000014179602000100000700000010', 'hex'),
				Buffer.from('000407ab00020005000000090000001004b600000100000700', 'hex'),
			],
		}
	}

	// Accessors for paths whose callers guarantee the socket is open. A missing
	// socket throws a TypeError, as the former direct null dereference did.
	requireTcpSocket(): net.Socket {
		if (!this.tcpSocket) throw new TypeError('TCP socket is not open')
		return this.tcpSocket
	}

	requireMainClient(): dgram.Socket {
		if (!this.mainClient) throw new TypeError('UDP main socket is not open')
		return this.mainClient
	}

	requireListenerClient(): dgram.Socket {
		if (!this.listenerClient) throw new TypeError('UDP listener socket is not open')
		return this.listenerClient
	}

	generateUniqueAuxId(): number {
		let attempts = 0
		const maxAttempts = 100
		let candidateId: number

		do {
			candidateId = crypto.randomInt(0, 65536)
			attempts++

			if (this.lastUsedSessionId !== null && candidateId === this.lastUsedSessionId) continue
			break
		} while (attempts < maxAttempts)

		this.lastUsedSessionId = candidateId
		return candidateId
	}

	throwIfClosing(): void {
		if (this.isClosing) {
			const error = new Error('Connection startup cancelled')
			error.name = 'AbortError'
			throw error
		}
	}

	// Start the connection process - auto-detects TCP (V16+) or UDP (V14)
	async start(): Promise<() => void> {
		this.throwIfClosing()

		this.emitter.emit('status', 'CONNECTING', 'Detecting protocol...')

		// Try TCP first (V16+/V18 detection)
		try {
			const tcpConnected = await this.tryTcpConnect()
			this.throwIfClosing()
			if (tcpConnected) {
				this.protocol = 'tcp'
				const result = await this.startTcp()
				if (result !== false) {
					return result
				}
				// Auth failed — fall through to UDP
			}
		} catch {
			// Any TCP detection/auth failure (timeout, refused, reset) means "not a
			// V16+ frame": fall back to UDP. Cancellation is re-checked just below.
		}

		this.throwIfClosing()
		// Fall back to UDP (V14)
		this.protocol = 'udp'
		return await this.startUdp()
	}

	// Try TCP connect to port 5000 with timeout, binding to suite listener port
	async tryTcpConnect(): Promise<boolean> {
		this.throwIfClosing()
		return new Promise<boolean>((resolve, reject) => {
			const sock = new net.Socket()
			this.tcpSocket = sock // Cleanup must own the socket during detection too.
			let settled = false

			const timer = setTimeout(() => {
				if (!settled) {
					settled = true
					sock.destroy()
					reject(new Error('TCP connect timeout'))
				}
			}, TCP_DETECT_TIMEOUT)

			sock.on('error', (err) => {
				if (!settled) {
					settled = true
					clearTimeout(timer)
					sock.destroy()
					reject(err)
				}
			})

			sock.once('close', () => {
				if (!settled) {
					settled = true
					clearTimeout(timer)
					reject(new Error('TCP detection socket closed'))
				}
			})

			// Connect without binding to a specific local port - the frame validates via
			// auth handshake, not source port. Using ephemeral ports avoids TIME_WAIT
			// conflicts when reconnecting after a disconnect.
			sock.connect(
				{
					port: this.initialServerPort,
					host: this.targetHost,
				},
				() => {
					if (!settled) {
						settled = true
						clearTimeout(timer)
						this.tcpSocket = sock
						resolve(true)
					}
				},
			)
		})
	}

	// TCP session frame wrapping
	tcpWrap(payload: Buffer): Buffer {
		const lenBuf = Buffer.alloc(2)
		lenBuf.writeUInt16BE(payload.length, 0)
		return Buffer.concat([SESSION_HEADER, lenBuf, payload, SESSION_TRAILER])
	}

	// TCP session frame unwrapping - returns (frames[], remainingBuffer)
	tcpUnwrap(buffer: Buffer): { frames: Buffer[]; remaining: Buffer } {
		const frames: Buffer[] = []
		while (true) {
			const idx = buffer.indexOf(SESSION_HEADER)
			if (idx === -1) {
				// No header: keep only a possible partial header at the tail.
				buffer = buffer.slice(Math.max(0, buffer.length - (SESSION_HEADER.length - 1)))
				break
			}
			if (idx > 0) buffer = buffer.slice(idx)
			if (buffer.length < 6) break
			const length = buffer.readUInt16BE(4)
			const frameEnd = 6 + length + 4
			if (buffer.length < frameEnd) {
				// A stray header with a large length must not hold back valid frames
				// already buffered behind it: resync on the next complete frame.
				const next = this.tcpNextCompleteFrame(buffer, 1)
				if (next === -1) break
				buffer = buffer.slice(next)
				continue
			}
			const trailer = buffer.slice(frameEnd - 4, frameEnd)
			if (!trailer.equals(SESSION_TRAILER)) {
				buffer = buffer.slice(4)
				continue
			}
			frames.push(buffer.slice(6, frameEnd - 4))
			buffer = buffer.slice(frameEnd)
		}
		return { frames, remaining: buffer }
	}

	// Offset of the first header at or after `from` that starts a complete frame
	// with a valid trailer, or -1.
	tcpNextCompleteFrame(buffer: Buffer, from: number): number {
		let idx = buffer.indexOf(SESSION_HEADER, from)
		while (idx !== -1 && buffer.length >= idx + 6) {
			const frameEnd = idx + 6 + buffer.readUInt16BE(idx + 4) + 4
			if (buffer.length >= frameEnd && buffer.slice(frameEnd - 4, frameEnd).equals(SESSION_TRAILER)) return idx
			idx = buffer.indexOf(SESSION_HEADER, idx + 1)
		}
		return -1
	}

	// TCP authentication packet
	tcpAuthPacket(seq: number, clientId = 0): Buffer {
		const nameBytes = Buffer.from(`${this.clientName}\x00`, 'ascii')
		const payload = Buffer.alloc(16 + nameBytes.length)
		let off = 0
		payload.writeUInt16BE(0x0002, off)
		off += 2 // prefix
		payload.writeUInt16BE(0x001f, off)
		off += 2 // cmd
		payload.writeUInt32BE(4 + nameBytes.length, off)
		off += 4 // outer_len = seq(2)+clientId(2)+name
		payload.writeUInt32BE(0x0000002c, off)
		off += 4
		payload.writeUInt16BE(seq, off)
		off += 2
		payload.writeUInt16BE(clientId, off)
		off += 2
		nameBytes.copy(payload, off)
		return this.tcpWrap(payload)
	}

	// CPL SetParam — sendToFrame()-compatible (UDP DATA header + CPL body).
	// sendToFrame() strips the 4-byte header for TCP and tcpWraps; sends as-is for UDP.
	// outer_len = 8 + data.length,  inner_len = outer_len + 8,  type_flags: 0x0800=string 0x0300=uint16
	buildSetParam(pid: number, typeFlags: number, did: number, data: Buffer): Buffer {
		const outerLen = 8 + data.length
		const innerLen = outerLen + 8
		const frame = Buffer.alloc(24 + data.length)
		let off = 0
		frame.writeUInt16BE(0x0004, off)
		off += 2 // UDP DATA type
		frame.writeUInt16BE(this.generateUniqueAuxId(), off)
		off += 2 // unique msg_id
		frame.writeUInt16BE(0x0002, off)
		off += 2 // CPL prefix
		frame.writeUInt16BE(0x0006, off)
		off += 2 // cmd SET (0x0006)
		frame.writeUInt32BE(outerLen, off)
		off += 4
		frame.writeUInt32BE(innerLen, off)
		off += 4
		frame.writeUInt16BE(pid, off)
		off += 2
		frame.writeUInt16BE(typeFlags, off)
		off += 2
		frame.writeUInt32BE(did, off)
		off += 4
		data.copy(frame, off)
		return frame
	}
	buildSetFrame(pid: number, typeFlags: number, did: number, data: Buffer): Buffer {
		return this.buildSetParam(pid, typeFlags, did, data)
	}

	// CPL SetEvent — sendToFrame()-compatible. outer = 8 + data.length, inner = outer + 7.
	// msgId override exists for the macro path: createMacroPayload() MUST keep the 0x03xx
	// message-ID page or the 4-byte UDP MACRO_ACK match (0002 03 id) breaks.
	buildSetEvent(eid: number, did: number, data: Buffer = Buffer.alloc(0), msgId: number | null = null): Buffer {
		const outerLen = 8 + data.length
		const frame = Buffer.alloc(24 + data.length)
		let off = 0
		frame.writeUInt16BE(0x0004, off)
		off += 2
		frame.writeUInt16BE(msgId !== null ? msgId : this.generateUniqueAuxId(), off)
		off += 2
		frame.writeUInt16BE(0x0002, off)
		off += 2
		frame.writeUInt16BE(0x0005, off)
		off += 2 // cmd SetEvent
		frame.writeUInt32BE(outerLen, off)
		off += 4
		frame.writeUInt32BE(outerLen + 7, off)
		off += 4 // inner = outer + 7
		frame.writeUInt16BE(eid, off)
		off += 2
		frame.writeUInt16BE(0x0000, off)
		off += 2
		frame.writeUInt32BE(did, off)
		off += 4
		data.copy(frame, off)
		return frame
	}

	// Announce module identity to Engineering > Panel Connections GUI after CONNECTED.
	// Works on both TCP (V16+/V18) and UDP (V14) via sendToFrame().
	announceIdentity(): void {
		if (this.isClosing) return
		const now = new Date()
		const pad = (n: number) => String(n).padStart(2, '0')
		const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
		const versionStr = `V${this.moduleVersion}`

		// Node Type = 8 (blank/unlabelled), PID 0x2008, DID 0x01000001, uint16
		this.sendToFrame(this.buildSetFrame(0x2008, 0x0300, 0x01000001, Buffer.from([0x00, 0x08])))
		// Version string, PID 0x134F, DID 0x2F003001
		this.sendToFrame(this.buildSetFrame(0x134f, 0x0800, 0x2f003001, Buffer.from(`${versionStr}\x00`, 'ascii')))
		// Time stamp, PID 0x1350, DID 0x2F003001
		this.sendToFrame(this.buildSetFrame(0x1350, 0x0800, 0x2f003001, Buffer.from(`${timeStr}\x00`, 'ascii')))
		// Date stamp, PID 0x1351, DID 0x2F003001
		this.sendToFrame(this.buildSetFrame(0x1351, 0x0800, 0x2f003001, Buffer.from(`${this.buildDate}\x00`, 'ascii')))
	}

	// TCP subscribe command (cmd 0x0008)
	tcpSubscribe(subId: number, flags: Buffer, sigAndParams: Buffer): Buffer {
		const payload = Buffer.alloc(48)
		let off = 0
		payload.writeUInt16BE(0x0002, off)
		off += 2 // prefix
		payload.writeUInt16BE(0x0008, off)
		off += 2 // cmd SUBSCRIBE
		payload.writeUInt32BE(0x00000024, off)
		off += 4 // outer length
		payload.writeUInt32BE(0x0000002e, off)
		off += 4 // inner length
		off += 16 // 16 zero bytes padding
		payload.writeUInt16BE(subId, off)
		off += 2
		flags.copy(payload, off)
		off += flags.length
		sigAndParams.copy(payload, off)
		return this.tcpWrap(payload)
	}

	// Parse frame version, name, build date from raw data
	parseFrameInfo(data: Buffer): FrameInfo {
		const ascii = Array.from(data)
			.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ' '))
			.join('')

		let version: string | null = null
		let name: string | null = null
		let buildDate: string | null = null

		// Frame software is V14, V18, V20…; year-style versions (V2026.0.9.5) are
		// client identities the frame relays, such as this module's own announcement.
		for (const m of ascii.matchAll(/V(\d+)\.\d+(?:\.\d+)?/g)) {
			if (Number(m[1]) < 1000) {
				version = m[0]
				break
			}
		}

		if (ascii.includes('Frame Facility Interface')) {
			name = 'Frame Facility Interface'
		} else {
			for (const ft of ['Kayenne', 'Karrera', 'GV Korona', 'K-Frame']) {
				if (ascii.includes(ft)) {
					name = ft
					break
				}
			}
		}

		const dMatch = ascii.match(/[A-Z][a-z]{2} +\d{1,2} \d{4}/)
		if (dMatch) buildDate = dMatch[0]

		return { version, name, buildDate }
	}

	// Start TCP path (V16+/V18). Returns cleanup closure on success, false on auth failure.
	async startTcp(): Promise<(() => void) | false> {
		this.throwIfClosing()
		this.emitter.emit('status', 'CONNECTING', 'TCP Authentication...')

		// K-Frame Menu waits ~1s after TCP connect before AUTH1 (capture-confirmed;
		// immediate AUTH races frame CPL-buffer registration on busy frames).
		await this.sleep(1000)

		// Auth packet 1 (seq=1)
		this.requireTcpSocket().write(this.tcpAuthPacket(0x0001))

		// Wait for a complete framed AUTH response (3s matches engine.py:1184-1185)
		const authOk = await this.tcpWaitForFrame(3000)
		this.throwIfClosing()

		if (!authOk) {
			this.abortTcpAttempt('No framed AUTH response within 3s')
			return false
		}

		// The AUTH response carries an assigned client ID at offset 14; it is
		// informational only (AUTH3 uses client ID 0), so it is not read.
		this.tcpAuthPayload = null

		// Install permanent error/close handlers AFTER auth succeeds
		this.requireTcpSocket().on('error', (err) => {
			this.emitter.emit('status', 'ERROR', `TCP error: ${err.message}`)
			this.cleanup()
		})
		this.requireTcpSocket().on('close', () => {
			if (!this.isClosing) {
				this.emitter.emit('status', 'DISCONNECTED', 'TCP connection closed by frame')
				this.cleanup()
			}
		})

		await this.sleep(500)

		// Auth packet 3 (seq=3, client ID 0 — not the assigned ID)
		this.requireTcpSocket().write(this.tcpAuthPacket(0x0003))
		await this.sleep(500)

		// Drain auth3 response
		this.tcpBuffer = Buffer.alloc(0)

		this.emitter.emit('status', 'CONNECTING', 'TCP Registration...')

		// Registration 1: 0x11e5
		this.requireTcpSocket().write(
			this.tcpSubscribe(
				0x0005,
				Buffer.from([0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00]),
				Buffer.from([0x11, 0xe5, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00]),
			),
		)
		await this.sleep(100)

		// Registration 2: 0x11a1
		this.requireTcpSocket().write(
			this.tcpSubscribe(
				0x0002,
				Buffer.from([0x00, 0x01, 0x00, 0x03, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x11, 0xa1, 0x00, 0x00, 0x62, 0x00, 0x00, 0x00]),
			),
		)
		await this.sleep(100)

		// Registration 3: 0x11a5
		this.requireTcpSocket().write(
			this.tcpSubscribe(
				0x0002,
				Buffer.from([0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x11, 0xa5, 0x00, 0x00, 0x62, 0x00, 0x00, 0x00]),
			),
		)
		await this.sleep(100)

		// Registration 4: 0x11e5 re-reg
		this.requireTcpSocket().write(
			this.tcpSubscribe(
				0x0005,
				Buffer.from([0x00, 0x01, 0x00, 0x03, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x11, 0xe5, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00]),
			),
		)
		await this.sleep(100)

		// Frame info subscriptions (sub_id 0x01fe, matching native GUI Wireshark capture)
		// First subscription: data[0]=0x01, sig[7]=0x0f
		this.requireTcpSocket().write(
			this.tcpSubscribe(
				0x01fe,
				Buffer.from([0x00, 0x01, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x00, 0x08, 0x00, 0x01, 0x01, 0x00, 0x00, 0x0f]),
			),
		)
		await this.sleep(100)
		// Second subscription: data[0]=0x02, sig[7]=0x01
		this.requireTcpSocket().write(
			this.tcpSubscribe(
				0x01fe,
				Buffer.from([0x00, 0x02, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x00, 0x08, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]),
			),
		)

		// NOW attach the permanent data handler (after auth is complete, no double-buffering)
		this.tcpBuffer = Buffer.alloc(0)
		this.requireTcpSocket().on('data', (data: Buffer) => this.handleTcpData(data))
		this.lastTcpDataTime = Date.now()
		this.mainHandshakeStage = 9 // Mark as connected (stage 9 = operational)
		this.secondPhaseDynamicCommPort = this.initialServerPort // Show frame port (5000) on button

		// Active TCP heartbeat: re-send frame info subscription every 8s
		// This keeps the connection alive and refreshes frame version data
		this.tcpActiveHeartbeatId = setInterval(() => {
			if (this.isClosing || !this.tcpSocket) {
				clearInterval(this.tcpActiveHeartbeatId ?? undefined)
				return
			}
			try {
				this.tcpSocket.write(
					this.tcpSubscribe(
						0x01fe,
						Buffer.from([0x00, 0x02, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
						Buffer.from([0x00, 0x08, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]),
					),
				)
			} catch {
				// Write failed - connection is dead; the passive monitor below or the
				// socket's own error/close handler performs the cleanup.
			}
		}, 8000)

		// Passive TCP heartbeat monitoring: disconnect if no data for 30 seconds
		this.tcpHeartbeatCheckId = setInterval(() => {
			if (this.isClosing) {
				clearInterval(this.tcpHeartbeatCheckId ?? undefined)
				return
			}
			const elapsed = Date.now() - this.lastTcpDataTime
			if (elapsed > 30000) {
				this.emitter.emit('status', 'HEARTBEAT_TIMEOUT', 'TCP connection lost (no data for 30s)')
				this.cleanup()
			}
		}, 5000)

		// Emit HANDSHAKE_COMPLETE, then wait for frame version before CONNECTED
		this.emitter.emit('status', 'HANDSHAKE_COMPLETE', 'TCP handshake complete, waiting for frame info...')

		// Wait a bit for frame info to arrive, then emit CONNECTED
		setTimeout(() => {
			if (this.mainHandshakeStage === 9 && !this.isClosing && !this.fullyConnected) {
				this.fullyConnected = true
				this.emitter.emit('status', 'CONNECTED', 'TCP connection established.')

				// Announce module identity to Engineering > Panel Connections
				this.announceIdentity()

				// Select suite after connected, then subscribe to macro catalog + status
				if (this.suite && this.suiteCommands[this.suite]) {
					this.tcpSelectSuite()
					// Subscribe to macro catalog 500ms after suite selection,
					// then macro status immediately after (TCP needs no deferral)
					setTimeout(() => {
						if (!this.isClosing) {
							this.subscribeMacroCatalog()
							this.subscribeMacroStatus()
						}
					}, 500)
				}
			}
		}, 2000)

		return () => this.cleanup()
	}

	// Handle incoming TCP data
	handleTcpData(data: Buffer): void {
		this.lastTcpDataTime = Date.now()
		this.tcpBuffer = Buffer.concat([this.tcpBuffer, data])

		const { frames, remaining } = this.tcpUnwrap(this.tcpBuffer)
		this.tcpBuffer = remaining

		for (const payload of frames) {
			// Try to parse frame info
			if (!this.frameVersion) {
				const info = this.parseFrameInfo(payload)
				if (info.version) {
					this.frameVersion = info.version
					this.frameName = info.name
					this.frameBuildDate = info.buildDate
					this.emitter.emit('status', 'FRAME_VERSION', {
						version: info.version,
						name: info.name,
						buildDate: info.buildDate,
					})
				}
			}

			// Only emit HEARTBEAT_ACK for frame info responses (our TCP heartbeat mechanism)
			// The active heartbeat re-subscribes to 0x01fe every 8s; the frame echoes sub_id 0x01fe
			// at payload offset 12 (after sub_cmd[2] + resp_type[2] + pay_len[4] + sec_len[4])
			// This prevents subscription data and command responses from triggering the connect button dot flash
			const isFrameInfoResponse = payload.length >= 14 && payload.readUInt16BE(12) === 0x01fe
			if (this.fullyConnected && isFrameInfoResponse) {
				this.emitter.emit('status', 'HEARTBEAT_ACK', 'TCP heartbeat response')
			}

			// Handle subscription data (AUX/ME bus updates)
			if (payload.length > 4) {
				// Wrap in a fake UDP-like format so handleSubscriptionData can parse it
				// handleSubscriptionData expects: [cmd_type:2][seq:2][data...]
				// For TCP, we just prepend a dummy 4-byte header
				const fakeMsg = Buffer.concat([Buffer.from([0x00, 0x04, 0x00, 0x00]), payload])
				this.handleSubscriptionData(fakeMsg)
			}
		}
	}

	async tcpWaitForFrame(timeoutMs: number): Promise<boolean> {
		this.throwIfClosing()
		const socket = this.tcpSocket
		return new Promise<boolean>((resolve) => {
			let settled = false
			let timer: NodeJS.Timeout | null = null
			let onData: ((chunk: Buffer) => void) | null = null
			let onFail: (() => void) | null = null

			const settle = (val: boolean) => {
				if (settled) return
				settled = true
				if (timer) clearTimeout(timer)
				if (socket) {
					if (onData) socket.removeListener('data', onData)
					if (onFail) {
						socket.removeListener('error', onFail)
						socket.removeListener('close', onFail)
					}
				}
				resolve(val)
			}

			const tryExtract = () => {
				const { frames, remaining } = this.tcpUnwrap(this.tcpBuffer)
				if (frames.length > 0) {
					this.tcpAuthPayload = frames[0]
					this.tcpBuffer = remaining
					settle(true)
				}
			}

			// Check bytes already in buffer
			tryExtract()
			if (settled) return

			onData = (chunk: Buffer) => {
				this.tcpBuffer = Buffer.concat([this.tcpBuffer, chunk])
				tryExtract()
			}
			onFail = () => settle(false)
			timer = setTimeout(() => settle(false), timeoutMs)

			// Without a socket and no buffered frame the wait rejects (as the former
			// null dereference did) instead of hanging until the timeout.
			if (!socket) throw new TypeError('TCP socket is not open')
			socket.on('data', onData)
			socket.on('error', onFail)
			socket.on('close', onFail)
		})
	}

	abortTcpAttempt(reason: string): void {
		this.throwIfClosing()
		this.emitter.emit('status', 'TCP_AUTH_FAILED', reason)
		if (this.tcpSocket) {
			this.tcpSocket.removeAllListeners()
			this.tcpSocket.destroy()
			this.tcpSocket = null
		}
		this.tcpBuffer = Buffer.alloc(0)
		this.tcpAuthPayload = null
		this.mainHandshakeStage = 1
		this.fullyConnected = false
	}

	// TCP suite selection
	tcpSelectSuite(): void {
		if (!this.suite || !this.suiteCommands[this.suite]) return

		// Get the RDP payloads from the existing suite commands (strip 4-byte UDP header)
		const cmds = this.suiteCommands[this.suite]
		const rdp1 = cmds[0].slice(4)
		this.requireTcpSocket().write(this.tcpWrap(rdp1))

		if (cmds.length > 1) {
			setTimeout(() => {
				if (!this.isClosing && this.tcpSocket) {
					const rdp2 = cmds[1].slice(4)
					this.tcpSocket.write(this.tcpWrap(rdp2))
				}
			}, 100)
		}
	}

	async sleep(ms: number): Promise<void> {
		this.throwIfClosing()
		await new Promise<void>((resolve, reject) => {
			const signal = this.startupAbort.signal
			const cancel = () => {
				clearTimeout(timer)
				signal.removeEventListener('abort', cancel)
				reject(new Error('Connection startup cancelled'))
			}
			const timer = setTimeout(() => {
				signal.removeEventListener('abort', cancel)
				resolve()
			}, ms)
			signal.addEventListener('abort', cancel, { once: true })
		})
		this.throwIfClosing()
	}

	// Subscribe to macro catalog (works on both TCP/V16+ and UDP/V14)
	subscribeMacroCatalog(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		if (!this.macroCatalogSubscribed) {
			this.macroCatalog.clear()
			this.macroCatalogReady = false
			this.macroCatalogDataSeen = false
			this.macroCatalogSubscribeAttempts = 0
			this.macroCatalogSubscribed = true
		}

		if (this.protocol === 'tcp') {
			if (!this.tcpSocket) {
				return { success: false, message: 'TCP socket not available.' }
			}
			this.sendMacroCatalogSubscribeTcp()
		} else {
			this.sendMacroCatalogSubscribeUdp()
		}

		this.startMacroCatalogRetryLoop()
		return { success: true, message: `Macro catalog subscription sent (${this.protocol}).` }
	}

	sendMacroCatalogSubscribeTcp(): void {
		if (!this.tcpSocket || this.isClosing) return

		this.tcpSocket.write(
			this.tcpSubscribe(
				0x0208,
				Buffer.from([0x00, 0x01, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x00, 0x23, 0x00, 0x01, 0x77, 0x00, 0x00, 0x00]),
			),
		)

		this.macroCatalogSubscribeAttempts += 1
	}

	/**
	 * Send macro catalog subscription over UDP (V14).
	 * Uses sub_id 0x020f with signature 0x0023 and params matching the V14 protocol.
	 */
	sendMacroCatalogSubscribeUdp(): void {
		if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) return

		const seqNum = this.subscriptionSequence++
		const packet = Buffer.alloc(52)
		let off = 0

		// Bytes 0-3: DATA header
		packet.writeUInt16BE(0x0004, off)
		off += 2 // Packet type (DATA)
		packet.writeUInt16BE(seqNum, off)
		off += 2 // Sequence number
		// Bytes 4-15: Subscribe command header
		packet.writeUInt16BE(0x0002, off)
		off += 2 // Sub-command
		packet.writeUInt16BE(0x0008, off)
		off += 2 // Command (SUBSCRIBE)
		packet.writeUInt32BE(0x00000024, off)
		off += 4 // Payload length (36)
		packet.writeUInt32BE(0x0000002e, off)
		off += 4 // Secondary length (46)
		// Bytes 16-31: Padding (zeros, already zero from alloc)
		off += 16
		// Bytes 32-51: Macro catalog subscription parameters
		packet.writeUInt16BE(0x020f, off)
		off += 2 // sub_id for V14 macro catalog
		Buffer.from([0x00, 0x01, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]).copy(packet, off)
		off += 10
		Buffer.from([0x00, 0x23, 0x00, 0x01, 0x77, 0x00, 0x00, 0x00]).copy(packet, off)

		this.mainClient.send(packet, this.secondPhaseDynamicCommPort, this.targetHost)
		this.macroCatalogSubscribeAttempts += 1
	}

	/**
	 * Send prerequisite registration subscribes over UDP (V14).
	 * The frame requires these subscribes to be in place before it will send
	 * macro catalog bulk data on the listener socket.
	 * Discovered via Wireshark capture of working client (rows 59-83).
	 */
	sendUdpRegistrationSubscribes(callback?: () => void): void {
		if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) {
			if (callback) callback()
			return
		}

		// Helper: send a raw hex payload wrapped in a DATA header
		const sendRawSub = (hexPayload: string) => {
			const payload = Buffer.from(hexPayload, 'hex')
			const seqNum = this.subscriptionSequence++
			const header = Buffer.alloc(4)
			header.writeUInt16BE(0x0004, 0)
			header.writeUInt16BE(seqNum, 2)
			const packet = Buffer.concat([header, payload])
			this.requireMainClient().send(packet, this.secondPhaseDynamicCommPort, this.targetHost)
		}

		// Build queue of all hex payloads to send
		const queue = [
			'0002000a0000001c0000002800000000000000000000000000000000000300030003000200000000',
			'00020008000000240000002e00000000000000000000000000000000000300010003000300000000138d000001000007',
			'0002000a0000001c0000002800000000000000000000000000000000002000050003000200000000',
			'0002000a0000001c0000002800000000000000000000000000000000376800040003000200000000',
			'0002000a0000001c000000280000000000000000000000000000000001fd00020004000200000000',
			'00020008000000240000002e0000000000000000000000000000000044320001000300030000000019f1000077000000',
			'00020008000000240000002e0000000000000000000000000000000044320002000300030000000019f0000077000000',
			'00020008000000240000002e0000000000000000000000000000000044320003000300030000000019f5000077000000',
			'00020008000000240000002e0000000000000000000000000000000044320004000300030000000019e8000077000000',
			'00020008000000240000002e0000000000000000000000000000000044320005000300030000000019eb000077000000',
		]
		// ME crosspoint subscribes (0x4433-0x443b) — needed for Crosspoint Magic action
		// Fixed: original packets were 47 bytes (14-byte padding instead of 16), causing
		// ulOffset >= ulSize parser errors. Now 48 bytes with correct 16-byte zero padding.
		for (let meSub = 0x4433; meSub <= 0x443b; meSub++) {
			const hex = meSub.toString(16).padStart(4, '0')
			queue.push(`00020008000000240000002e00000000000000000000000000000000${hex}0001000300030000000019eb000077000000`)
		}

		// Send one packet every 50ms to avoid CPLScheduler buffer overflow
		let idx = 0
		const sendNext = () => {
			if (this.isClosing || idx >= queue.length) {
				if (callback) callback()
				return
			}
			sendRawSub(queue[idx])
			idx++
			setTimeout(sendNext, 50)
		}
		sendNext()
	}

	startMacroCatalogRetryLoop(): void {
		this.stopMacroCatalogRetryLoop()
		this.macroCatalogRetryTimerId = setInterval(() => {
			if (this.isClosing || !this.macroCatalogSubscribed || this.macroCatalogDataSeen) {
				this.stopMacroCatalogRetryLoop()
				return
			}

			if (this.macroCatalogSubscribeAttempts >= this.MAX_MACRO_SUBSCRIBE_ATTEMPTS) {
				this.stopMacroCatalogRetryLoop()
				this.emitter.emit('status', 'MACRO_CATALOG_TIMEOUT', {
					attempts: this.macroCatalogSubscribeAttempts,
				})
				return
			}

			if (this.protocol === 'tcp') {
				this.sendMacroCatalogSubscribeTcp()
			} else {
				this.sendMacroCatalogSubscribeUdp()
			}
		}, this.MACRO_SUBSCRIBE_RETRY_MS)
	}

	stopMacroCatalogRetryLoop(): void {
		if (this.macroCatalogRetryTimerId) {
			clearInterval(this.macroCatalogRetryTimerId)
			this.macroCatalogRetryTimerId = null
		}
	}

	// --- Macro status subscription (sub_id 0x0234, sig 0x2F, list-0, DID 0x77000000) ---

	subscribeMacroStatus(): void {
		if (this.isClosing || this.mainHandshakeStage !== 9) return
		if (this.macroStatusSubscribed) return

		this.macroStatus.clear()
		this.lastPlayedMacro = null
		this.runSeq++
		this.macroStatusSubscribed = true

		if (this.protocol === 'tcp') {
			this.sendMacroStatusSubscribeTcp()
		} else {
			this.sendMacroStatusSubscribeUdp()
		}
		this.emitter.emit('status', 'MACRO_STATUS_SUBSCRIBED', `${this.protocol} sub_id 0x0234`)
	}

	sendMacroStatusSubscribeTcp(): void {
		if (!this.tcpSocket || this.isClosing) return
		this.tcpSocket.write(
			this.tcpSubscribe(
				0x0234,
				Buffer.from([0x00, 0x01, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]),
				Buffer.from([0x00, 0x2f, 0x00, 0x00, 0x77, 0x00, 0x00, 0x00]),
			),
		)
	}

	sendMacroStatusSubscribeUdp(): void {
		if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) return
		const seqNum = this.subscriptionSequence++
		const packet = Buffer.alloc(52)
		let off = 0
		packet.writeUInt16BE(0x0004, off)
		off += 2
		packet.writeUInt16BE(seqNum, off)
		off += 2
		packet.writeUInt16BE(0x0002, off)
		off += 2
		packet.writeUInt16BE(0x0008, off)
		off += 2
		packet.writeUInt32BE(0x00000024, off)
		off += 4
		packet.writeUInt32BE(0x0000002e, off)
		off += 4
		off += 16 // padding
		packet.writeUInt16BE(0x0234, off)
		off += 2
		Buffer.from([0x00, 0x01, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]).copy(packet, off)
		off += 10
		Buffer.from([0x00, 0x2f, 0x00, 0x00, 0x77, 0x00, 0x00, 0x00]).copy(packet, off)
		this.mainClient.send(packet, this.secondPhaseDynamicCommPort, this.targetHost)
	}

	// eMacroStatus constants (V18.0.2 SharedEnums.eMacroStatus):
	//   0=Stop 1=Play 2=Record 3=Load 4=Save 5=StopSave 6=StopPlay 7=Pause 8=Append
	static MS_ALL = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8])
	static MS_ACTIVE = new Set([1, 7])
	static STATUS_RANK: Readonly<Partial<Record<number, number>>> = { 7: 3, 1: 2, 6: 2, 3: 1, 2: 1 }

	// OID linked-list form (V18.0.2): walk block headers, structured — can't false-match.
	statusEntriesOid(msg: Buffer, pb: number, payLen: number): MacroStatusEntry[] {
		const out: MacroStatusEntry[] = []
		const n = pb + payLen
		let pos = pb + 16 // skip 16-byte sub-header
		while (pos + 12 <= n) {
			const dataLen = msg.readUInt16BE(pos + 10)
			const ds = pos + 12
			if (ds + dataLen > n) break
			if (dataLen >= 6) {
				const index = msg.readUInt16BE(ds)
				const macroNum = msg.readUInt16BE(ds + 2) + 1
				const nul = msg.indexOf(0x00, ds + 4)
				if (nul !== -1 && nul >= ds + 4 && nul + 3 <= ds + dataLen) {
					const status = msg.readUInt16BE(nul + 1)
					if (macroNum >= 1 && macroNum <= 999 && HandshakeConnection.MS_ALL.has(status)) {
						out.push({ index, macroNum, status })
					}
				}
			}
			pos = ds + dataLen
		}
		return out
	}

	// Legacy marker form: scan for 00 [01|02] 00 0e pattern. Fallback when OID yields nothing.
	statusEntriesMarker(msg: Buffer, pb: number, payLen: number): MacroStatusEntry[] {
		const out: MacroStatusEntry[] = []
		const end = pb + payLen
		for (let j = pb; j + 15 <= end; j++) {
			if (
				msg[j] === 0x00 &&
				(msg[j + 1] === 0x01 || msg[j + 1] === 0x02) &&
				msg[j + 2] === 0x00 &&
				msg[j + 3] === 0x0e
			) {
				const index = msg.readUInt16BE(j + 4)
				const macroNum = msg.readUInt16BE(j + 6) + 1
				const status = msg.readUInt16BE(j + 13)
				if (macroNum >= 1 && macroNum <= 999 && HandshakeConnection.MS_ALL.has(status)) {
					out.push({ index, macroNum, status })
				}
			}
		}
		return out
	}

	// Shared post-processing: priority merge, active-state update, play detection.
	applyStatusEntries(entries: MacroStatusEntry[]): void {
		const seen = new Map<number, number>()
		for (const { macroNum, status } of entries) {
			const prev = seen.get(macroNum)
			if (
				prev === undefined ||
				(HandshakeConnection.STATUS_RANK[status] || 0) > (HandshakeConnection.STATUS_RANK[prev] || 0)
			) {
				seen.set(macroNum, status)
			}
		}

		const before = new Map(this.macroStatus)
		for (const [num, status] of seen) {
			if (HandshakeConnection.MS_ACTIVE.has(status)) {
				this.macroStatus.set(num, status)
			} else {
				this.macroStatus.delete(num)
			}
		}

		// Play detection (engine.py 646-671): IndexID 0 = ring head = last-played macro.
		// A push carrying IndexID 0 is a play IF the macro was NOT already running
		// (fresh start / instant-macro reporting Stopped) OR Playing->Playing (retrigger).
		const prevLastPlayed = this.lastPlayedMacro
		const head = entries.find((e) => e.index === 0)
		if (head) {
			const was = before.get(head.macroNum)
			if (was === undefined || (head.status === 1 && was === 1)) {
				this.lastPlayedMacro = head.macroNum
			}
		}

		const changed = !this.mapsEqual(before, this.macroStatus) || this.lastPlayedMacro !== prevLastPlayed
		if (changed) {
			this.runSeq++
			this.emitter.emit('status', 'MACRO_STATUS_CHANGED', {
				origin: 'frame',
				macroStatus: Object.fromEntries(this.macroStatus),
				lastPlayedMacro: this.lastPlayedMacro,
				runSeq: this.runSeq,
			})
		}
	}

	mapsEqual<K, V>(a: Map<K, V>, b: Map<K, V>): boolean {
		if (a.size !== b.size) return false
		for (const [k, v] of a) {
			if (b.get(k) !== v) return false
		}
		return true
	}

	// Main entry point: OID first (structured, can't false-match), marker fallback.
	parseMacroStatusData(msg: Buffer, pb: number, payLen: number): void {
		let entries = this.statusEntriesOid(msg, pb, payLen)
		if (!entries.length) entries = this.statusEntriesMarker(msg, pb, payLen)
		if (!entries.length) return
		this.applyStatusEntries(entries)
	}

	getMacroRunState(): MacroRunState {
		return {
			macroStatus: Object.fromEntries(this.macroStatus),
			lastPlayedMacro: this.lastPlayedMacro,
			runSeq: this.runSeq,
		}
	}

	getMacroStatusForMacro(macroNum: number): number | null {
		return this.macroStatus.get(macroNum) || null
	}

	/**
	 * Subscribe to source names from the frame (0x0210 engineering names + 0x020b operator names).
	 * Source names are subscribed FIRST so they're cached before AUX/ME data arrives.
	 * Works on both TCP and UDP via sendToFrame().
	 */
	subscribeToSourceNames(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		if (this.sourceNamesSubscribed) {
			return { success: true, message: 'Already subscribed to source names.' }
		}

		// Build a 52-byte source name subscription packet.
		// Source name subs put the signature at bytes 32-33 (not a sub_id).
		const buildSourceNamePacket = (sig: number, flags6: number[], params8: number[]) => {
			const seqNum = this.subscriptionSequence++
			const packet = Buffer.alloc(52)
			let off = 0

			// Bytes 0-31: Standard subscription header
			packet.writeUInt16BE(0x0004, off)
			off += 2 // 0-1:   Packet type (DATA)
			packet.writeUInt16BE(seqNum, off)
			off += 2 // 2-3:   Sequence number
			packet.writeUInt16BE(0x0002, off)
			off += 2 // 4-5:   Sub-command
			packet.writeUInt16BE(0x0008, off)
			off += 2 // 6-7:   Command (SUBSCRIBE)
			packet.writeUInt32BE(0x00000024, off)
			off += 4 // 8-11:  Payload length (36)
			packet.writeUInt32BE(0x0000002e, off)
			off += 4 // 12-15: Secondary length (46)
			off += 16 // 16-31: Padding (zeros)

			// Bytes 32-51: Source name subscription parameters
			packet.writeUInt16BE(sig, off)
			off += 2 // 32-33: Signature (0x0210 or 0x020b)
			Buffer.from(flags6).copy(packet, off)
			off += 6 // 34-39: Flags
			packet.writeUInt32BE(0x00000000, off)
			off += 4 // 40-43: Reserved (zeros)
			Buffer.from(params8).copy(packet, off) // 44-51: Params

			return packet
		}

		// 1. Source definitions (0x0210) - engineering names
		const srcDefPacket = buildSourceNamePacket(
			0x0210,
			[0x00, 0x01, 0x00, 0x04, 0x00, 0x02], // flags
			[0x00, 0x10, 0x00, 0x01, 0x62, 0x00, 0x00, 0x00], // params
		)
		this.sendToFrame(srcDefPacket)

		// Wait 100ms then send 0x020b (operator-customized names)
		setTimeout(() => {
			if (this.isClosing) return
			const srcNamePacket = buildSourceNamePacket(
				0x020b,
				[0x00, 0x01, 0x00, 0x04, 0x00, 0x03], // flags
				[0x00, 0x0c, 0x00, 0x01, 0x64, 0x1b, 0x00, 0x00], // params
			)
			this.sendToFrame(srcNamePacket)
		}, 100)

		this.sourceNamesSubscribed = true
		return { success: true, message: 'Source name subscriptions sent.' }
	}

	// Parse macro catalog data from a TCP payload
	parseMacroCatalogData(payload: Buffer): number {
		// OID range for macro slots: base = 0x1A8E. The slot OID's high 2 bytes are always
		// 0x0000, so the real ceiling is 0xFFFF; the old stride-1 assumption (0x1E75)
		// truncated V17/V18 catalogs mid-dump. macroNum 1..999 + dataLen guards already
		// protect against false matches.
		const MACRO_BASE_ADDR = 0x1a8e
		const MACRO_MAX_ADDR = 0xffff
		const subBytes = Buffer.from([0x02, 0x08])
		const sigBytes = Buffer.from([0x00, 0x23])
		let found = 0

		// Require both macro sub_id and macro signature in the payload.
		const subIdx = payload.indexOf(subBytes)
		if (subIdx === -1) return 0
		const sigIdx = payload.indexOf(sigBytes, subIdx)
		if (sigIdx === -1) return 0

		// Skip signature(2) + params(6) to reach entry area.
		let pos = sigIdx + 8
		while (pos < payload.length - 12) {
			// Look for 4-byte address pattern: 00 00 XX XX where XX XX is in macro OID range
			if (payload[pos] === 0x00 && payload[pos + 1] === 0x00) {
				const addr = payload.readUInt16BE(pos + 2)
				if (addr >= MACRO_BASE_ADDR && addr <= MACRO_MAX_ADDR) {
					const hdr = pos + 4 // Skip this_addr (4 bytes)

					// Need at least next_addr(4) + field_count(2) + data_len(2) = 8 bytes
					if (hdr + 8 > payload.length) break

					const dataLen = payload.readUInt16BE(hdr + 6)
					const dataStart = hdr + 8

					// Ignore implausible or truncated candidates and continue scanning.
					if (dataLen > 500 || dataStart + dataLen > payload.length) {
						pos += 2
						continue
					}

					const data = payload.slice(dataStart, dataStart + dataLen)

					// First 2 bytes are the embedded macro_index (1-based, matches user-facing number).
					if (data.length >= 2) {
						const macroNum = data.readUInt16BE(0)
						const nameData = data.slice(2)
						const textFields = nameData.toString('ascii').split('\x00')
						const oled = (textFields[0] || '').trim()
						const panel = (textFields[1] || '').trim()
						const comment = (textFields[2] || '').trim()

						if (macroNum >= 1 && macroNum <= 999) {
							if (oled || panel || comment) {
								this.macroCatalog.set(macroNum, {
									oled,
									panel,
									comment,
								})
							} else {
								// Empty macro - remove if it was previously named
								this.macroCatalog.delete(macroNum)
							}
							found++
						}
					}

					// Advance past this entry
					pos = dataStart + dataLen
					continue
				}
			}
			pos++
		}

		return found
	}

	// V14 UDP macro catalog parser (the V14 subscription reply path).
	// Each entry: prevOID(4) + nextOID(4) + field_count(2) + data_len(2)
	//             + data: [macro_index(2) + name1\0 + name2\0 + name3\0]
	parseMacroCatalogDataV14(msg: Buffer, pb: number, payLen: number): number {
		let found = 0
		// Sub-header at pb is 16 bytes: sub_id(2) + flags(6) + sig(2) + params(2) + pad(4)
		// First packet may have a 12-byte zero sentinel entry after this which the loop skips naturally
		let pos = pb + 16
		const endPos = pb + payLen

		while (pos + 12 <= endPos) {
			// pos+0..3 = prevOID, pos+4..7 = nextOID (not used for macro number)
			// pos+8..9 = field_count (always 1 in practice), pos+10..11 = data_len
			const dataLen = msg.readUInt16BE(pos + 10)
			const dataStart = pos + 12

			if (dataStart + dataLen > endPos) break

			if (dataLen >= 2) {
				const macroIndex = msg.readUInt16BE(dataStart)
				// V14 UDP uses 1-based macro indices (1-999), not 0-based like TCP
				const macroNum = macroIndex

				if (macroIndex >= 1 && macroIndex <= 999) {
					// Parse null-separated name strings after the 2-byte macro index
					const nameData = msg.slice(dataStart + 2, dataStart + dataLen)
					const textFields = nameData.toString('ascii').split('\x00')
					const oled = (textFields[0] || '').trim()
					const panel = (textFields[1] || '').trim()
					const comment = (textFields[2] || '').trim()

					if (oled || panel || comment) {
						this.macroCatalog.set(macroNum, {
							oled,
							panel,
							comment,
						})
					} else {
						this.macroCatalog.delete(macroNum)
					}
					found++
				}
			}

			pos += 12 + dataLen
		}

		return found
	}

	// Reset bulk load timer - called each time macro data arrives
	resetMacroCatalogBulkTimer(): void {
		if (this.macroCatalogBulkTimerId) {
			clearTimeout(this.macroCatalogBulkTimerId)
		}
		// Publish the initial catalog and subsequent changed batches after a quiet
		// period. Readiness remains true; repeated identical dumps need no UI refresh.
		this.macroCatalogBulkTimerId = setTimeout(() => {
			this.macroCatalogBulkTimerId = null
			if (this.isClosing) return
			const catalog = Object.fromEntries(this.macroCatalog)
			const snapshot = JSON.stringify(catalog)
			this.macroCatalogReady = true
			this.stopMacroCatalogRetryLoop()
			if (snapshot !== this.lastPublishedMacroCatalog) {
				this.lastPublishedMacroCatalog = snapshot
				this.emitter.emit('status', 'MACRO_CATALOG_READY', {
					totalNamed: this.macroCatalog.size,
					catalog,
				})
			}

			// V14 UDP: subscribe once after the initial dump settles. Later catalog
			// updates must not clear or restart the existing macro-status subscription.
			if (this.protocol === 'udp' && !this.macroStatusSubscribed) {
				this.subscribeMacroStatus()
			}
		}, 2000)
	}

	// Get macro name (OLED) by number
	getMacroName(macroNum: number): string | null {
		const entry = this.macroCatalog.get(macroNum)
		if (!entry) return null
		return entry.oled || entry.panel || entry.comment || null
	}

	// Get full macro catalog as plain object
	getMacroCatalog(): Record<number, MacroCatalogEntry> {
		return Object.fromEntries(this.macroCatalog)
	}

	// Start UDP path (V14) - original handshake process
	async startUdp(): Promise<() => void> {
		this.throwIfClosing()
		this.mainClient = dgram.createSocket('udp4')
		this.listenerClient = dgram.createSocket('udp4')

		return new Promise<() => void>((resolve, reject) => {
			let settled = false
			const signal = this.startupAbort.signal
			const finish = (error?: Error | null) => {
				if (settled) return
				settled = true
				signal.removeEventListener('abort', cancel)
				this.requireMainClient().removeListener('error', onError)
				this.requireListenerClient().removeListener('error', onError)
				if (error) reject(error)
				else resolve(() => this.cleanup())
			}
			const cancel = () => finish(new Error('Connection startup cancelled'))
			const onError = (error: Error) => finish(error)
			signal.addEventListener('abort', cancel, { once: true })
			this.requireMainClient().once('error', onError)
			this.requireListenerClient().once('error', onError)
			this.setupMainClientHandlers()
			this.setupListenerClientHandlers()

			this.requireMainClient().bind(this.mainClientPort, () => {
				if (this.isClosing) {
					this.cleanup()
					return
				}
				this.requireListenerClient().bind(this.listenerClientPort, () => {
					if (this.isClosing) {
						this.cleanup()
						return
					}
					this.emitter.emit('status', 'CONNECTING', 'Starting Initial Handshake...')
					if (this.isClosing) {
						this.cleanup()
						return
					}
					this.requireMainClient().send(this.payloadPacket1, this.initialServerPort, this.targetHost, (err) => {
						if (this.isClosing) {
							this.cleanup()
							return
						}
						if (err) {
							finish(err)
							this.emitter.emit('status', 'ERROR', `Error sending Packet 1: ${err.message}`)
							this.cleanup()
						} else {
							this.mainHandshakeStage = 2
							this.startPacket1RetryTimer()
							this.startHandshakeTimeout()
							finish()
						}
					})
				})
			})
		})
	}

	setupMainClientHandlers(): void {
		this.requireMainClient().on('error', (err) => {
			this.emitter.emit('status', 'ERROR', `Main Client error: ${err.message}`)
			this.cleanup()
		})

		this.requireMainClient().on('message', (msg, rinfo) => {
			this.handleMainClientMessage(msg, rinfo)
		})
	}

	setupListenerClientHandlers(): void {
		this.requireListenerClient().on('error', (err) => {
			this.emitter.emit('status', 'ERROR', `Listener Client error: ${err.message}`)
			this.cleanup()
		})

		this.requireListenerClient().on('message', (msg, rinfo) => {
			this.handleListenerClientMessage(msg, rinfo)
		})
	}

	handleMainClientMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
		// Handshake 1
		if (
			this.mainHandshakeStage === 2 &&
			rinfo.port === this.initialServerPort &&
			msg.equals(this.expectedPayloadPacket2)
		) {
			if (this.packet1RetryIntervalId) {
				clearInterval(this.packet1RetryIntervalId)
				this.packet1RetryIntervalId = null
			}
			this.mainHandshakeStage = 3
			this.requireMainClient().send(this.payloadPacket3, this.initialServerPort, this.targetHost)
		} else if (
			this.mainHandshakeStage === 3 &&
			rinfo.port === this.initialServerPort &&
			msg.equals(this.expectedPayloadPacket4)
		) {
			this.mainHandshakeStage = 4
			this.requireMainClient().send(this.payloadPacket5, this.initialServerPort, this.targetHost)
		} else if (
			this.mainHandshakeStage === 4 &&
			rinfo.port === this.initialServerPort &&
			msg.equals(this.expectedPayloadPacket6)
		) {
			this.mainHandshakeStage = 5
			if (this.announcedTargetPort > 0) {
				this.mainHandshakeStage = 6
				this.requireMainClient().send(this.payloadPacket12, this.announcedTargetPort, this.targetHost)
			}
		}
		// Handshake 2
		else if (
			this.mainHandshakeStage === 6 &&
			rinfo.port === this.announcedTargetPort &&
			msg.equals(this.expectedPayloadPacket13)
		) {
			this.secondPhaseDynamicCommPort = rinfo.port
			this.mainHandshakeStage = 7
			this.requireMainClient().send(this.payloadPacket14, this.secondPhaseDynamicCommPort, this.targetHost)
		} else if (
			this.mainHandshakeStage === 7 &&
			rinfo.port === this.secondPhaseDynamicCommPort &&
			msg.equals(this.expectedPayloadPacket15)
		) {
			this.mainHandshakeStage = 8
			const sequenceBuffer = Buffer.alloc(2)
			sequenceBuffer.writeUInt16BE(3, 0)
			const payloadPacket16 = Buffer.concat([
				this.payloadPacket16Base,
				sequenceBuffer,
				Buffer.alloc(2),
				this.payloadPacket16Client,
			])
			this.requireMainClient().send(payloadPacket16, this.secondPhaseDynamicCommPort, this.targetHost)
		} else if (
			this.mainHandshakeStage === 8 &&
			rinfo.port === this.secondPhaseDynamicCommPort &&
			msg.equals(this.expectedPayloadPacket17)
		) {
			if (this.handshakeOverallTimeoutId) {
				clearTimeout(this.handshakeOverallTimeoutId)
				this.handshakeOverallTimeoutId = null
			}
			this.emitter.emit('status', 'HANDSHAKE_COMPLETE', 'Handshake complete, sending suite command...')
			this.mainHandshakeStage = 9
			this.sendSuiteCommand()
			this.startHeartbeat()
			// Subscribe to frame info (V14 UDP)
			setTimeout(() => {
				if (!this.isClosing && this.protocol === 'udp') {
					this.udpSubscribeFrameInfo()
				}
			}, 300)
			// Send prerequisite registration subscribes 3400ms after suite command (rate-limited 50ms each).
			// The 3s extra delay lets the EIC panel finish its own initialization so we don't
			// overflow the frame's shared CPLScheduler queue (max 46 items).
			// Once all registration subscribes are sent, wait 500ms then subscribe to macro catalog.
			setTimeout(() => {
				if (!this.isClosing && this.protocol === 'udp') {
					this.sendUdpRegistrationSubscribes(() => {
						// After all registration subscribes sent, wait 500ms for frame to process
						setTimeout(() => {
							if (!this.isClosing) {
								this.subscribeMacroCatalog()
							}
						}, 500)
					})
				} else if (!this.isClosing) {
					// TCP path: subscribe directly
					this.subscribeMacroCatalog()
				}
			}, 3400)
		}
		// Heartbeat/Macro phase
		else if (this.mainHandshakeStage === 9 && rinfo.port === this.secondPhaseDynamicCommPort) {
			// ACK inbound data/control packets (0x0001/0x0004/0x0006). Do NOT ACK 0x0002 (those
			// are the frame's ACKs/heartbeat responses — handled below).
			if (msg.length >= 4) {
				const pktType = msg.readUInt16BE(0)
				if (pktType === 0x0001 || pktType === 0x0004 || pktType === 0x0006) {
					this.requireMainClient().send(this.buildAck(msg), rinfo.port, rinfo.address)
				}
			}

			if (
				this.lastSentMacroId !== null &&
				msg.length === 4 &&
				msg[0] === 0x00 &&
				msg[1] === 0x02 &&
				msg[2] === 0x03 &&
				msg[3] === this.lastSentMacroId
			) {
				this.emitter.emit('status', 'MACRO_ACK', `${this.lastSentMacroId}`)
				this.lastSentMacroId = null
			} else if (msg.equals(this.expectedServerHeartbeatResponse)) {
				const currentTime = Date.now()
				if (this.lastHeartbeatResponseTime === 0) {
					this.lastHeartbeatResponseTime = currentTime
					setTimeout(() => {
						if (this.mainHandshakeStage === 9 && !this.isClosing) {
							this.fullyConnected = true
							this.emitter.emit('status', 'CONNECTED', 'Heartbeat established.')
							this.announceIdentity()
						}
					}, 2000)
				} else {
					this.lastHeartbeatResponseTime = currentTime
					// Emit heartbeat ACK for visual indicator
					this.emitter.emit('status', 'HEARTBEAT_ACK', 'Heartbeat acknowledged.')
				}
				this.missedHeartbeats = 0
			} else if (msg.length > 4) {
				// Try to parse frame info from any data packet (V14 UDP)
				if (!this.frameVersion) {
					const info = this.parseFrameInfo(msg.slice(4)) // Skip 4-byte DATA header
					if (info.version) {
						this.frameVersion = info.version
						this.frameName = info.name
						this.frameBuildDate = info.buildDate
						this.emitter.emit('status', 'FRAME_VERSION', {
							version: info.version,
							name: info.name,
							buildDate: info.buildDate,
						})
					}
				}
				// Handle subscription data (AUX/ME bus updates)
				this.handleSubscriptionData(msg)
			}
		}
	}

	handleListenerClientMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
		if (rinfo.port === this.portAnnounceServerPort) {
			// Port announcement handshake (from port 5001)
			if (msg.equals(this.expectedPayloadPacket7)) {
				this.requireListenerClient().send(this.payloadPacket8, rinfo.port, rinfo.address)
			} else if (msg.length >= 20) {
				const newlyAnnouncedPort = msg.readUInt16BE(18)
				if (newlyAnnouncedPort > 0 && newlyAnnouncedPort < 65536) {
					this.announcedTargetPort = newlyAnnouncedPort
					this.requireListenerClient().send(this.expectedPayloadPacket10, rinfo.port, rinfo.address, (err) => {
						if (!err) {
							if (this.mainHandshakeStage === 5) {
								this.mainHandshakeStage = 6
								this.requireMainClient().send(this.payloadPacket12, this.announcedTargetPort, this.targetHost)
							}
							// NOTE: Do NOT close the listener socket here.
							// The frame sends subscription data back on the listener port
							// from a dynamically assigned port (e.g., 5203).
						}
					})
				}
			}
		} else if (rinfo.address === this.targetHost) {
			// Data from the frame on a port other than 5001 (e.g., subscription data channel)
			if (msg.length === 4 && msg.equals(this.expectedPayloadPacket7)) {
				// Channel-establish (00010000) — response is 00020000 which is byte-identical
				// to an ACK of seq 0. No behavior change from the type-gated rule below.
				this.requireListenerClient().send(this.payloadPacket8, rinfo.port, rinfo.address)
				this.emitter.emit('status', 'AUX_DATA_CHANNEL', `Subscription data channel established on port ${rinfo.port}`)
			} else if (msg.length >= 4) {
				// ACK inbound data/control packets by type (matches engine.py listener ACK rule).
				const pktType = msg.readUInt16BE(0)
				if (pktType === 0x0001 || pktType === 0x0004 || pktType === 0x0006) {
					this.requireListenerClient().send(this.buildAck(msg), rinfo.port, rinfo.address)
				}

				if (msg.length > 4) {
					if (!this.frameVersion) {
						const info = this.parseFrameInfo(msg.slice(4))
						if (info.version) {
							this.frameVersion = info.version
							this.frameName = info.name
							this.frameBuildDate = info.buildDate
							this.emitter.emit('status', 'FRAME_VERSION', {
								version: info.version,
								name: info.name,
								buildDate: info.buildDate,
							})
						}
					}
					this.handleSubscriptionData(msg)
				}
			}
		}
	}

	sendSuiteCommand(): void {
		if (this.suite && this.suiteCommands[this.suite]) {
			if (this.protocol === 'tcp') {
				this.tcpSelectSuite()
			} else {
				const suiteCommandMessages = this.suiteCommands[this.suite]
				this.sendToFrame(suiteCommandMessages[0], (err) => {
					if (!err && suiteCommandMessages.length > 1) {
						setTimeout(() => {
							if (this.isClosing) return
							this.sendToFrame(suiteCommandMessages[1])
						}, 100)
					}
				})
			}
		}
	}

	// Send frame info subscription over UDP (sub_id 0x01fd, matching Python reference)
	udpSubscribeFrameInfo(): void {
		if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) return
		this.udpMsgCounter = (this.udpMsgCounter || 0) + 1
		const pkt = Buffer.alloc(52)
		let off = 0
		// DATA header: 0004 + msg_counter
		pkt.writeUInt16BE(0x0004, off)
		off += 2
		pkt.writeUInt16BE(this.udpMsgCounter, off)
		off += 2
		// Subscribe command header
		pkt.writeUInt16BE(0x0002, off)
		off += 2 // type
		pkt.writeUInt16BE(0x0008, off)
		off += 2 // cmd (SUBSCRIBE)
		pkt.writeUInt32BE(0x00000024, off)
		off += 4 // header_len
		pkt.writeUInt32BE(0x0000002e, off)
		off += 4 // total_len
		// 16 zero bytes padding (already zero from alloc)
		off += 16
		// sub_id 0x01fd + flags
		pkt.writeUInt16BE(0x01fd, off)
		off += 2
		Buffer.from([0x00, 0x01, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]).copy(pkt, off)
		off += 10
		// sig + params
		Buffer.from([0x00, 0x08, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]).copy(pkt, off)
		this.mainClient.send(pkt, this.secondPhaseDynamicCommPort, this.targetHost)
	}

	startHeartbeat(): void {
		this.lastHeartbeatResponseTime = 0
		this.missedHeartbeats = 0

		if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId)
		this.heartbeatIntervalId = setInterval(() => {
			if (this.mainHandshakeStage === 9 && !this.isClosing) {
				this.missedHeartbeats++
				if (this.missedHeartbeats >= this.MAX_MISSED_HEARTBEATS) {
					this.emitter.emit('status', 'HEARTBEAT_TIMEOUT', 'Connection lost after 5 missed heartbeats.')
					this.cleanup()
					return
				}
				this.requireMainClient().send(this.clientHeartbeatPayload, this.secondPhaseDynamicCommPort, this.targetHost)
			} else {
				clearInterval(this.heartbeatIntervalId ?? undefined)
			}
		}, this.heartbeatIntervalMs)
	}

	startPacket1RetryTimer(): void {
		this.packet1RetryIntervalId = setInterval(() => {
			if (this.mainHandshakeStage === 2 && !this.isClosing) {
				this.requireMainClient().send(this.payloadPacket1, this.initialServerPort, this.targetHost)
			} else {
				clearInterval(this.packet1RetryIntervalId ?? undefined)
				this.packet1RetryIntervalId = null
			}
		}, 1000)
	}

	startHandshakeTimeout(): void {
		if (this.handshakeOverallTimeoutId) clearTimeout(this.handshakeOverallTimeoutId)
		this.handshakeOverallTimeoutId = setTimeout(() => {
			this.emitter.emit('status', 'HANDSHAKE_TIMEOUT_ERROR', "Couldn't connect (timeout)")
			this.cleanup()
		}, this.handshakeTimeoutMs)
	}

	cleanup(): void {
		const alreadyClosing = this.isClosing
		this.isClosing = true
		this.startupAbort.abort()
		this.fullyConnected = false // Reset fully connected flag
		this.frameVersion = null // Reset frame version
		// Clear before DISCONNECTED so refreshed labels cannot use this frame's old names.
		this.sourceNames.clear()
		this.macroCatalog.clear() // Clear macro catalog
		this.macroCatalogReady = false
		this.lastPublishedMacroCatalog = null
		this.macroCatalogSubscribed = false
		this.macroCatalogDataSeen = false
		this.macroCatalogSubscribeAttempts = 0
		if (this.macroCatalogBulkTimerId) clearTimeout(this.macroCatalogBulkTimerId)
		this.macroCatalogBulkTimerId = null
		this.stopMacroCatalogRetryLoop()
		this.macroStatus.clear()
		this.lastPlayedMacro = null
		if (!alreadyClosing) this.runSeq++
		this.macroStatusSubscribed = false
		// (no optimistic timer to clear — frame is sole source of truth)
		this.subscribedAuxes.clear() // Reset subscription tracking so we re-subscribe on reconnect
		this.auxState.clear() // Clear cached AUX state
		this.subscribedMEs.clear() // Reset ME subscription tracking
		this.meState.clear() // Clear cached ME state
		this.keyerState.clear()
		this.timelineSubscriptionIds.clear()
		this.timelineSubscribed = false
		this.timelineState = { cursorTime: null, duration: null, pauseState: 0, runState: null, pausePoints: [] }
		this.timelineKeyframeSubscriptionId = null
		this.timelineKeyframes.clear()
		this.imageStoreState.clear()
		this.imageStoreSubscriptionIds.clear()
		this.imageStoreSubscribed = false
		this.transitionTelemetry.clear()
		this.transitionSubscriptionIds.clear()
		this.transitionTelemetrySubscribed = false
		if (!alreadyClosing) this.emitter.emit('status', 'DISCONNECTED', 'Closing connection...')

		if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId)
		if (this.packet1RetryIntervalId) clearInterval(this.packet1RetryIntervalId)
		if (this.handshakeOverallTimeoutId) clearTimeout(this.handshakeOverallTimeoutId)
		if (this.tcpHeartbeatCheckId) clearInterval(this.tcpHeartbeatCheckId)
		if (this.tcpActiveHeartbeatId) clearInterval(this.tcpActiveHeartbeatId)

		// Close TCP socket
		try {
			if (this.tcpSocket) {
				this.tcpSocket.destroy()
				this.tcpSocket = null
			}
		} catch {
			// destroy() on an already-destroyed socket is harmless; cleanup must not throw.
		}

		// Also close sockets still binding; repeated cleanup must remain safe.
		for (const socket of [this.mainClient, this.listenerClient]) {
			try {
				socket?.close()
			} catch {
				/* Already closed or never bound. */
			}
		}
	}

	// Build a 4-byte ACK: 0x0002 + echoed sequence bytes [2..3] from the inbound packet.
	buildAck(msg: Buffer): Buffer {
		const ack = Buffer.alloc(4)
		ack.writeUInt16BE(0x0002, 0)
		msg.copy(ack, 2, 2, 4)
		return ack
	}

	// Protocol-aware send: strips UDP DATA header for TCP, wraps in session framing
	sendToFrame(buffer: Buffer, callback?: SendCallback): void {
		if (this.protocol === 'tcp') {
			if (!this.tcpSocket || this.isClosing) {
				if (callback) callback(new Error('TCP socket not available'))
				return
			}
			const rdpPayload = buffer.slice(4)
			const wrapped = this.tcpWrap(rdpPayload)
			this.tcpSocket.write(wrapped, callback)
		} else {
			if (this.isClosing || !this.mainClient || !this.secondPhaseDynamicCommPort || !this.targetHost) {
				if (callback) callback(new Error('UDP socket not available'))
				return
			}
			// A socket closed outside cleanup() throws synchronously; report it instead.
			try {
				this.mainClient.send(buffer, this.secondPhaseDynamicCommPort, this.targetHost, callback)
			} catch (err) {
				// dgram throws Error instances (e.g. ERR_SOCKET_DGRAM_NOT_RUNNING).
				if (callback) callback(err instanceof Error ? err : new Error(String(err)))
			}
		}
	}

	// Command methods
	sendMacro(macroNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		// Validate macro number (1-999)
		if (!Number.isInteger(macroNum) || macroNum < 1 || macroNum > 999) {
			return { success: false, message: 'Invalid macro number (must be a whole number from 1-999).' }
		}

		// Decide Play vs Continue based on live macro status
		const currentStatus = this.macroStatus.get(macroNum)
		const eid = currentStatus === 7 ? 0x0042 : 0x0002 // Paused → Continue, else Play
		const verb = eid === 0x0042 ? 'Continue' : 'Play'

		// Generate a unique ID
		const macroIdNum = this.generateUniqueId()
		const macroPayload = this.createMacroPayload(macroNum, macroIdNum, eid)

		this.macroQueue.push({ macroNum, macroPayload, macroIdNum, eid })

		// If not already processing, start the queue
		if (!this.isSendingMacro) {
			this.processMacroQueue()
		}

		return { success: true, message: `Macro ${macroNum} ${verb} command sent.` }
	}

	sendMacroStop(macroNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		if (!Number.isInteger(macroNum) || macroNum < 1 || macroNum > 999) {
			return { success: false, message: 'Invalid macro number (must be a whole number from 1-999).' }
		}
		const macroIdNum = this.generateUniqueId()
		const macroPayload = this.createMacroPayload(macroNum, macroIdNum, 0x0003)
		this.macroQueue.push({ macroNum, macroPayload, macroIdNum, eid: 0x0003 })
		if (!this.isSendingMacro) this.processMacroQueue()
		return { success: true, message: `Macro ${macroNum} Stop command sent.` }
	}

	sendMacroStopAll(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		// Drop queued Play/Continue/Stop commands so none fire after Stop-All.
		this.macroQueue.length = 0
		// Official K-Frame Macro Control Stop-All: normal Stop event with the
		// all-macros sentinel, including macros paused at a User Wait.
		const payload = this.buildSetEvent(0x0003, 0x77000000, Buffer.from([0xff, 0xff, 0xff, 0xff]))
		this.sendToFrame(payload, (err) => {
			if (err) {
				this.emitter.emit('status', 'WARNING', `Error sending macro stop-all: ${err.message}`)
			} else {
				this.emitter.emit('status', 'MACRO_STOP_ALL_SENT', 'Stop-All sent')
				this.macroStatus.clear()
				this.runSeq++
				this.emitter.emit('status', 'MACRO_STATUS_CHANGED', {
					origin: 'local',
					macroStatus: Object.fromEntries(this.macroStatus),
					lastPlayedMacro: this.lastPlayedMacro,
					runSeq: this.runSeq,
				})
			}
		})
		return { success: true, message: 'Macro Stop-All command sent.' }
	}

	generateUniqueId(): number {
		let attempts = 0
		let candidateId: number

		do {
			candidateId = this.nextMacroId
			this.nextMacroId = (this.nextMacroId + 1) % 256

			attempts++
			if (attempts > 256) {
				if (this.recentlyUsedIds.length > 0) {
					candidateId = this.recentlyUsedIds.shift() ?? candidateId
				}
				break
			}
		} while (this.recentlyUsedIds.includes(candidateId))

		this.recentlyUsedIds.push(candidateId)

		if (this.recentlyUsedIds.length > this.MAX_TRACKED_IDS) {
			this.recentlyUsedIds.shift()
		}

		return candidateId
	}

	createMacroPayload(macroNumber: number, macroIdNum: number, eid = 0x0002): Buffer {
		const data = Buffer.alloc(4)
		data.writeUInt16BE(macroNumber - 1, 0)
		// data[2..3] = 0x0000 (runSource = 0, live-verified)
		return this.buildSetEvent(eid, 0x77000000, data, 0x0300 | macroIdNum)
	}

	processMacroQueue(): void {
		if (this.isSendingMacro || this.macroQueue.length === 0 || this.isClosing || this.mainHandshakeStage !== 9) {
			return
		}

		const next = this.macroQueue.shift()
		if (!next) return // Unreachable: the queue was checked non-empty above.
		this.isSendingMacro = true
		const { macroNum, macroPayload, macroIdNum, eid } = next

		this.lastSentMacroId = macroIdNum

		this.sendToFrame(macroPayload, (err) => {
			if (err) {
				this.emitter.emit('status', 'MACRO_ERROR', `${macroNum} ${err.message}`)
				this.lastSentMacroId = null
			} else {
				this.emitter.emit('status', 'MACRO_SENT', `${macroNum} ${macroPayload.toString('hex')}`)
				this.afterMacroFire(macroNum, eid)
			}
			setTimeout(() => {
				this.isSendingMacro = false
				this.processMacroQueue()
			}, this.macroSendDelayMs)
		})
	}

	/**
	 * Post-fire bookkeeping — matches the Shotbox's _after_fire().
	 * Play:     set lastPlayedMacro + bump runSeq.  Do NOT inject an optimistic
	 *           Playing entry — the frame is the sole source of truth for
	 *           macroStatus.  A no-pause macro stops too fast for a frame push,
	 *           but lastPlayedMacro handles the "last-played" indicator.
	 * Continue: optimistically drop from active map so a stale Paused entry
	 *           can't wedge the button into sending a dead Continue.
	 */
	afterMacroFire(macroNum: number, eid: number): void {
		let changed = false

		if (eid === 0x0002) {
			this.lastPlayedMacro = macroNum
			changed = true
		} else if (eid === 0x0042) {
			if (this.macroStatus.has(macroNum)) {
				this.macroStatus.delete(macroNum)
			}
			changed = true
		} else if (eid === 0x0003) {
			if (this.macroStatus.has(macroNum)) {
				this.macroStatus.delete(macroNum)
			}
			changed = true
		}

		if (changed) {
			this.runSeq++
			this.emitter.emit('status', 'MACRO_STATUS_CHANGED', {
				origin: 'local',
				macroStatus: Object.fromEntries(this.macroStatus),
				lastPlayedMacro: this.lastPlayedMacro,
				runSeq: this.runSeq,
			})
		}
	}

	sendAuxRoute(auxNum: number, sourceNum: number, transitionType = 'cut'): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		// Validate aux number (1-96)
		if (!Number.isInteger(auxNum) || auxNum < 1 || auxNum > 96) {
			return { success: false, message: 'Invalid aux number (must be a whole number from 1-96).' }
		}

		// Validate source number (1-850)
		if (!Number.isInteger(sourceNum) || sourceNum < 1 || sourceNum > 850) {
			return { success: false, message: 'Invalid source number (must be a whole number from 1-850).' }
		}

		try {
			const auxIndex = auxNum - 1
			let transByte: number
			switch (transitionType) {
				case 'mix':
					transByte = 0x01
					break
				case 'wipe':
					transByte = 0x02
					break
				default:
					transByte = 0x00
					break
			}
			const data = Buffer.alloc(4)
			data.writeUInt16BE(sourceNum, 0)
			data[2] = transByte
			data[3] = 0x01
			const payload = this.buildSetEvent(0x007e, 0x19000100 + auxIndex, data)

			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending aux route: ${err.message}`)
				} else {
					const previousSource = this.auxState.get(auxNum) || null
					this.auxState.set(auxNum, sourceNum)
					if (previousSource !== sourceNum) {
						this.emitter.emit('auxStateChanged', {
							origin: 'local',
							auxNum,
							previousSource,
							currentSource: sourceNum,
						})
					}
					this.emitter.emit('status', 'AUX_ROUTE_SENT', `Aux ${auxNum} -> Source ${sourceNum} (${transitionType})`)
				}
			})

			return { success: true, message: `Routing Aux ${auxNum} to Source ${sourceNum} (${transitionType})` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendImageStore(outputNum: number, imageNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		// Validate output number (1-10)
		if (!Number.isInteger(outputNum) || outputNum < 1 || outputNum > 10) {
			return { success: false, message: 'Invalid output number (must be a whole number from 1-10).' }
		}

		// Validate image number (1-8999)
		if (!Number.isInteger(imageNum) || imageNum < 1 || imageNum > 8999) {
			return { success: false, message: 'Invalid image number (must be a whole number from 1-8999).' }
		}

		try {
			const data = Buffer.alloc(4)
			data.writeUInt32BE(imageNum, 0)
			const payload = this.buildSetParam(0x1730, 0x0400, 0x43000010 + outputNum, data)

			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending image store: ${err.message}`)
				} else {
					this.imageStoreState.set(outputNum, imageNum)
					this.emitter.emit('imageStoreStateChanged', { origin: 'local', output: outputNum, image: imageNum })
					this.emitter.emit('status', 'IMAGE_STORE_SENT', `Output ${outputNum} -> Image ${imageNum}`)
				}
			})

			return { success: true, message: `Setting Output ${outputNum} to Image ${imageNum}` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendImageStoreInput(inputNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		if (!Number.isInteger(inputNum) || inputNum < 1 || inputNum > 850) {
			return { success: false, message: 'Invalid input number (must be a whole number from 1-850).' }
		}

		try {
			const data = Buffer.alloc(2)
			data.writeUInt16BE(inputNum, 0)
			const payload = this.buildSetParam(0x104a, 0x0100, 0x8c001601, data)

			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending image store input: ${err.message}`)
				} else {
					this.emitter.emit('status', 'IMAGE_STORE_INPUT_SENT', `Input -> ${inputNum}`)
				}
			})

			return { success: true, message: `Setting Image Store input to ${inputNum}` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendEMem(eMemNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		if (!Number.isInteger(eMemNum) || eMemNum < 0 || eMemNum > 999) {
			return { success: false, message: 'Invalid EMEM number (must be a whole number from 0-999).' }
		}

		try {
			const data = Buffer.alloc(7)
			data.writeUInt16BE(eMemNum, 4)
			const payload = this.buildSetEvent(0x0041, 0x35000001, data)

			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending EMEM: ${err.message}`)
				} else {
					this.emitter.emit('status', 'EMEM_SENT', `EMEM ${eMemNum}`)
				}
			})

			return { success: true, message: `EMEM ${eMemNum} sent` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendRawCommand(hexCommand: string): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		if (!hexCommand || typeof hexCommand !== 'string') {
			return { success: false, message: 'Invalid hex command.' }
		}

		try {
			const hex = hexCommand.trim().toLowerCase()
			if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0)
				return { success: false, message: 'Raw command is not valid hex.' }
			if (hex.length < 32) return { success: false, message: 'Raw command too short.' }
			if (!hex.startsWith('0004'))
				return { success: false, message: 'Raw command must start with UDP DATA header 0004.' }
			const cmd = hex.substring(12, 16)
			if (!['0005', '0006', '0008', '0020'].includes(cmd))
				return { success: false, message: `Unsupported CPL command 0x${cmd}.` }

			const messageId = this.generateUniqueAuxId()
			const messageIdHex = messageId.toString(16).padStart(4, '0')
			const modifiedHexCommand = hex.substring(0, 4) + messageIdHex + hex.substring(8)

			const payload = Buffer.from(modifiedHexCommand, 'hex')

			// Send command
			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending raw command: ${err.message}`)
				} else {
					this.emitter.emit('status', 'RAW_COMMAND_SENT', `Command sent`)
				}
			})

			return { success: true, message: `Raw command sent` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendPanelMem(panelMemNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		if (!Number.isInteger(panelMemNum) || panelMemNum < 1 || panelMemNum > 99) {
			return { success: false, message: 'Invalid panel memory number (must be a whole number from 1-99).' }
		}

		try {
			const data = Buffer.alloc(2)
			data.writeUInt16BE(panelMemNum, 0)
			const payload = this.buildSetParam(0x14d2, 0x0300, 0x22000000, data)

			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending panel memory: ${err.message}`)
				} else {
					this.emitter.emit('status', 'PANEL_MEM_SENT', `Panel Memory ${panelMemNum}`)
				}
			})

			return { success: true, message: `Panel Memory ${panelMemNum} sent` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendCrosspoint(pid: number, did: number, sourceNum: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		if (pid !== 0x104a && pid !== 0x103a) {
			return { success: false, message: 'Invalid crosspoint PID.' }
		}
		if (!(Number.isInteger(did) && did >= 0 && did <= 0xffffffff)) {
			return { success: false, message: 'Invalid target DID.' }
		}
		if (!Number.isInteger(sourceNum) || sourceNum < 1 || sourceNum > 809) {
			return { success: false, message: 'Invalid source number (must be a whole number from 1-809).' }
		}
		try {
			const data = Buffer.alloc(2)
			data.writeUInt16BE(sourceNum, 0)
			const payload = this.buildSetParam(pid, 0x0100, did, data)
			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending crosspoint: ${err.message}`)
				} else {
					// meState contains only A-D buses (PID 0x104A). Keyer DIDs
					// share their low byte, so PID 0x103A must not update this cache.
					if (pid === 0x104a) {
						const address = did & 0xff
						const previousSource = this.meState.get(address) || null
						this.meState.set(address, sourceNum)
						if (previousSource !== sourceNum) {
							this.emitter.emit('meStateChanged', {
								origin: 'local',
								address,
								previousSource,
								currentSource: sourceNum,
							})
						}
					}
					this.emitter.emit(
						'status',
						'CROSSPOINT_SENT',
						`PID 0x${pid.toString(16)} DID 0x${did.toString(16)} src ${sourceNum}`,
					)
				}
			})
			return { success: true, message: `Crosspoint sent` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendTransitionEvent(eid: number, did: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		if (eid !== 0x0043 && eid !== 0x0044) {
			return { success: false, message: 'Invalid transition EID.' }
		}
		if (!(Number.isInteger(did) && did >= 0 && did <= 0xffffffff)) {
			return { success: false, message: 'Invalid target DID.' }
		}
		try {
			const payload = this.buildSetEvent(eid, did)
			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending transition: ${err.message}`)
				} else {
					this.emitter.emit('status', 'TRANSITION_SENT', `EID 0x${eid.toString(16)} DID 0x${did.toString(16)}`)
				}
			})
			return { success: true, message: `Transition event sent` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	sendTimelineEvent(eid: number, did: number, data: number[]): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		const isByte = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 0xff
		if (
			!Number.isInteger(eid) ||
			eid < 0 ||
			eid > 0xffff ||
			!Number.isInteger(did) ||
			did < 0 ||
			did > 0xffffffff ||
			!Array.isArray(data) ||
			!data.every(isByte)
		) {
			return { success: false, message: 'Invalid timeline command.' }
		}
		try {
			const payload = this.buildSetEvent(eid, did, Buffer.from(data))
			this.sendToFrame(payload, (err) => {
				if (err) this.emitter.emit('status', 'WARNING', `Error sending timeline command: ${err.message}`)
				else this.emitter.emit('status', 'TIMELINE_SENT', `EID 0x${eid.toString(16)} DID 0x${did.toString(16)}`)
			})
			return { success: true, message: 'Timeline command sent' }
		} catch (error) {
			return { success: false, message: `Error creating timeline command: ${errorMessage(error)}` }
		}
	}

	sendEMemTargeted(eMemNum: number, did: number, mode: number): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		if (!Number.isInteger(eMemNum) || eMemNum < 0 || eMemNum > 999) {
			return { success: false, message: 'Invalid EMEM number (must be a whole number from 0-999).' }
		}
		if (!Number.isInteger(mode) || mode < 0 || mode > 2) {
			return { success: false, message: 'Invalid EMEM mode (must be a whole number from 0-2).' }
		}
		if (!(Number.isInteger(did) && did >= 0 && did <= 0xffffffff)) {
			return { success: false, message: 'Invalid target DID.' }
		}
		try {
			const data = Buffer.alloc(8)
			data.writeUInt16BE(eMemNum, 4)
			data.writeUInt16BE(mode, 6)
			const payload = this.buildSetEvent(0x0041, did, data)
			this.sendToFrame(payload, (err) => {
				if (err) {
					this.emitter.emit('status', 'WARNING', `Error sending targeted EMEM: ${err.message}`)
				} else {
					this.emitter.emit('status', 'EMEM_TARGETED_SENT', `EMEM ${eMemNum} DID 0x${did.toString(16)} mode ${mode}`)
				}
			})
			return { success: true, message: `Targeted EMEM ${eMemNum} sent` }
		} catch (error) {
			return { success: false, message: `Error creating command: ${errorMessage(error)}` }
		}
	}

	// ─── AUX Bus Subscription Methods ────────────────────────────────────

	/**
	 * Build a subscription packet for a single AUX bus source selection (0x104a).
	 * Per GV K-Frame protocol: one 52-byte packet per AUX bus, marker 0x19.
	 * @param {number} busIndex - AUX bus index 0-95 (0x00-0x5f)
	 */
	buildAuxSubscriptionPacket(busIndex: number): SubscriptionPacket {
		const seqNum = this.subscriptionSequence++
		const subId = this.nextSubscriptionId++

		const packet = Buffer.alloc(52)
		let offset = 0

		// Bytes 0-31: Standard subscription header (identical for all types)
		packet.writeUInt16BE(0x0004, offset)
		offset += 2 // 0-1:   Packet type (DATA)
		packet.writeUInt16BE(seqNum, offset)
		offset += 2 // 2-3:   Sequence number
		packet.writeUInt16BE(0x0002, offset)
		offset += 2 // 4-5:   Sub-command
		packet.writeUInt16BE(0x0008, offset)
		offset += 2 // 6-7:   Command (SUBSCRIBE)
		packet.writeUInt32BE(0x00000024, offset)
		offset += 4 // 8-11:  Payload length (36)
		packet.writeUInt32BE(0x0000002e, offset)
		offset += 4 // 12-15: Secondary length (46)
		offset += 16 // 16-31: Padding (zeros)

		// Bytes 32-51: AUX subscription parameters
		packet.writeUInt16BE(subId, offset)
		offset += 2 // 32-33: Subscription ID
		packet.writeUInt16BE(0x0001, offset)
		offset += 2 // 34-35: Flag
		packet.writeUInt16BE(0x0003, offset)
		offset += 2 // 36-37: Flag
		packet.writeUInt16BE(0x0003, offset)
		offset += 2 // 38-39: Flag
		packet.writeUInt32BE(0x00000000, offset)
		offset += 4 // 40-43: Reserved (zeros)
		packet.writeUInt16BE(0x104a, offset)
		offset += 2 // 44-45: Signature
		packet.writeUInt16BE(0x0000, offset)
		offset += 2 // 46-47: Read flags
		packet.writeUInt8(0x19, offset)
		offset += 1 // 48:    Marker byte (AUX)
		packet.writeUInt16BE(0x0000, offset)
		offset += 2 // 49-50: Address (PGM layer)
		packet.writeUInt8(busIndex, offset) // 51:    AUX bus index

		return { packet, subId }
	}

	/**
	 * Build a subscription packet for a single ME bus source selection (0x104a).
	 * Per GV K-Frame protocol: one 52-byte packet per ME bus, marker 0x04.
	 * @param {number} address - ME address byte: (bus_code << 4) | me_num
	 *   bus_code: A=0, B=1, C=2, D=3
	 *   me_num: ME1=0, ME2=1, ME3=2, PGM=3, ME4=4
	 */
	buildMESubscriptionPacket(address: number): SubscriptionPacket {
		const seqNum = this.subscriptionSequence++
		const subId = this.nextSubscriptionId++

		const packet = Buffer.alloc(52)
		let offset = 0

		// Bytes 0-31: Standard subscription header (identical for all types)
		packet.writeUInt16BE(0x0004, offset)
		offset += 2 // 0-1:   Packet type (DATA)
		packet.writeUInt16BE(seqNum, offset)
		offset += 2 // 2-3:   Sequence number
		packet.writeUInt16BE(0x0002, offset)
		offset += 2 // 4-5:   Sub-command
		packet.writeUInt16BE(0x0008, offset)
		offset += 2 // 6-7:   Command (SUBSCRIBE)
		packet.writeUInt32BE(0x00000024, offset)
		offset += 4 // 8-11:  Payload length (36)
		packet.writeUInt32BE(0x0000002e, offset)
		offset += 4 // 12-15: Secondary length (46)
		offset += 16 // 16-31: Padding (zeros)

		// Bytes 32-51: ME subscription parameters
		packet.writeUInt16BE(subId, offset)
		offset += 2 // 32-33: Subscription ID
		packet.writeUInt16BE(0x0001, offset)
		offset += 2 // 34-35: Flag
		packet.writeUInt16BE(0x0003, offset)
		offset += 2 // 36-37: Flag
		packet.writeUInt16BE(0x0003, offset)
		offset += 2 // 38-39: Flag
		packet.writeUInt32BE(0x00000000, offset)
		offset += 4 // 40-43: Reserved (zeros)
		packet.writeUInt16BE(0x104a, offset)
		offset += 2 // 44-45: Signature
		packet.writeUInt16BE(0x0000, offset)
		offset += 2 // 46-47: Read flags
		packet.writeUInt8(0x04, offset)
		offset += 1 // 48:    Marker byte (ME)
		packet.writeUInt16BE(0x0000, offset)
		offset += 2 // 49-50: Reserved
		packet.writeUInt8(address, offset) // 51:    ME address byte

		return { packet, subId }
	}

	/** Build a captured-format scalar CPL parameter subscription (PID + DID). */
	buildParameterSubscriptionPacket(pid: number, did: number, subId = this.nextSubscriptionId++): SubscriptionPacket {
		const packet = Buffer.alloc(52)
		let offset = 0
		packet.writeUInt16BE(0x0004, offset)
		offset += 2
		packet.writeUInt16BE(this.subscriptionSequence++, offset)
		offset += 2
		packet.writeUInt16BE(0x0002, offset)
		offset += 2
		packet.writeUInt16BE(0x0008, offset)
		offset += 2
		packet.writeUInt32BE(0x00000024, offset)
		offset += 4
		packet.writeUInt32BE(0x0000002e, offset)
		offset += 4
		offset += 16
		packet.writeUInt16BE(subId, offset)
		offset += 2
		packet.writeUInt16BE(0x0001, offset)
		offset += 2
		packet.writeUInt16BE(0x0003, offset)
		offset += 2
		packet.writeUInt16BE(0x0003, offset)
		offset += 2
		packet.writeUInt32BE(0x00000000, offset)
		offset += 4
		packet.writeUInt16BE(pid, offset)
		offset += 2
		packet.writeUInt16BE(0x0000, offset)
		offset += 2
		packet.writeUInt32BE(did, offset)
		return { packet, subId }
	}

	/** Build the captured CPL list subscription envelope used by the Menu. */
	buildListSubscriptionPacket(lid: number, did: number, subId = this.nextSubscriptionId++): SubscriptionPacket {
		const packet = Buffer.alloc(52)
		let offset = 0
		packet.writeUInt16BE(0x0004, offset)
		offset += 2
		packet.writeUInt16BE(this.subscriptionSequence++, offset)
		offset += 2
		packet.writeUInt16BE(0x0002, offset)
		offset += 2
		packet.writeUInt16BE(0x0008, offset)
		offset += 2
		packet.writeUInt32BE(0x00000024, offset)
		offset += 4
		packet.writeUInt32BE(0x0000002e, offset)
		offset += 4
		offset += 16
		packet.writeUInt16BE(subId, offset)
		offset += 2
		packet.writeUInt16BE(0x0001, offset)
		offset += 2
		packet.writeUInt16BE(0x0004, offset)
		offset += 2
		packet.writeUInt16BE(0x0002, offset)
		offset += 2
		packet.writeUInt32BE(0x00000000, offset)
		offset += 4
		packet.writeUInt16BE(lid, offset)
		offset += 2
		packet.writeUInt16BE(0x0001, offset)
		offset += 2
		packet.writeUInt32BE(did, offset)
		return { packet, subId }
	}

	subscribeToMasterTimeline(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}
		if (this.timelineSubscribed) return { success: true, message: 'Already subscribed to master timeline.' }

		const did = 0x35000001
		const parameters: TimelineParameterSubscription[] = [
			{ pid: 5904, key: 'cursorTime' },
			{ pid: 5905, key: 'duration' },
			{ pid: 5921, key: 'pauseState' },
			{ pid: 5012, key: 'runState' },
		]
		let index = 0
		const sendNext = () => {
			if (this.isClosing) return
			if (index >= parameters.length) {
				const list = this.buildListSubscriptionPacket(4, did)
				this.timelineKeyframeSubscriptionId = list.subId
				this.sendToFrame(list.packet)
				this.timelineSubscribed = true
				this.emitter.emit('status', 'TIMELINE_SUBSCRIBED', 'Subscribed to master timeline state and keyframes')
				return
			}
			const parameter = parameters[index++]
			const { packet, subId } = this.buildParameterSubscriptionPacket(parameter.pid, did)
			this.timelineSubscriptionIds.set(subId, parameter)
			this.sendToFrame(packet)
			setTimeout(sendNext, 50)
		}
		sendNext()
		return { success: true, message: 'Master timeline subscription in progress.' }
	}

	parseTimelineParameterResponse(msg: Buffer, pb: number, payLen: number): boolean {
		if (payLen < 22 || pb + payLen > msg.length) return false
		const subId = msg.readUInt16BE(pb)
		const expected = this.timelineSubscriptionIds.get(subId)
		if (!expected) return false
		const pid = msg.readUInt16BE(pb + 8)
		const did = msg.readUInt32BE(pb + 12)
		const dataType = msg.readUInt16BE(pb + 18)
		if (pid !== expected.pid || did !== 0x35000001) return false

		let value: number
		if ([5, 11, 12, 13, 14, 15, 16, 17].includes(dataType) && payLen >= 24) value = msg.readFloatBE(pb + 20)
		else if (dataType === 0 || dataType === 18) value = msg.readInt16BE(pb + 20)
		else if (dataType === 1 && payLen >= 24) value = msg.readInt32BE(pb + 20)
		else if (dataType === 2) value = msg.readUInt16BE(pb + 20)
		else if (dataType === 3 && payLen >= 24) value = msg.readUInt32BE(pb + 20)
		else if (dataType === 4) value = msg[pb + 20] ? 1 : 0
		else return false
		if (!Number.isFinite(value)) return false

		if (this.timelineState[expected.key] !== value) {
			this.timelineState[expected.key] = value
			this.emitter.emit('timelineStateChanged', { origin: 'frame', ...this.timelineState })
		}
		return true
	}

	parseTimelineKeyframeResponse(msg: Buffer, pb: number, payLen: number): boolean {
		if (payLen < 16 || pb + payLen > msg.length) return false
		if (msg.readUInt16BE(pb) !== this.timelineKeyframeSubscriptionId) return false
		if (msg.readUInt16BE(pb + 2) !== 0x0001 || msg.readUInt16BE(pb + 4) !== 0x0004) return false
		if (msg.readUInt16BE(pb + 8) !== 4 || msg.readUInt32BE(pb + 12) !== 0x35000001) return false

		let changed = false
		let pos = pb + 16
		const end = pb + payLen
		while (pos + 12 <= end) {
			const handle = msg.readUInt32BE(pos)
			const status = msg.readUInt16BE(pos + 8)
			const itemSize = msg.readUInt16BE(pos + 10)
			const next = pos + 12 + itemSize
			if (next > end) break

			if (status === 0) {
				if (this.timelineKeyframes.size > 0) changed = true
				this.timelineKeyframes.clear()
			} else if ((status === 1 || status === 2) && itemSize >= 6) {
				const time = msg.readFloatBE(pos + 12)
				const pause = msg[pos + 16]
				if (Number.isFinite(time)) {
					const previous = this.timelineKeyframes.get(handle)
					if (!previous || previous.time !== time || previous.pause !== pause) changed = true
					this.timelineKeyframes.set(handle, { time, pause })
				}
			} else if (status === 3) {
				changed = this.timelineKeyframes.delete(handle) || changed
			}
			pos = next
		}

		if (changed) {
			const pausePoints = [...this.timelineKeyframes.values()]
				.filter((item) => item.pause > 0)
				.map((item) => item.time)
				.sort((a, b) => a - b)
			this.timelineState.pausePoints = [...new Set(pausePoints)]
			this.emitter.emit('timelineStateChanged', {
				origin: 'frame',
				...this.timelineState,
				pausePoints: [...this.timelineState.pausePoints],
			})
		}
		return true
	}

	subscribeToImageStore(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) return { success: false, message: 'Not connected.' }
		if (this.imageStoreSubscribed) return { success: true, message: 'Already subscribed to Image Store outputs.' }
		let output = 1
		const sendNext = () => {
			if (this.isClosing || output > 10) {
				if (output > 10) this.imageStoreSubscribed = true
				return
			}
			const current = output++
			const { packet, subId } = this.buildParameterSubscriptionPacket(5936, 0x43000010 + current)
			this.imageStoreSubscriptionIds.set(subId, current)
			this.sendToFrame(packet)
			setTimeout(sendNext, 50)
		}
		sendNext()
		return { success: true, message: 'Image Store output subscription in progress.' }
	}

	parseImageStoreParameterResponse(msg: Buffer, pb: number, payLen: number): boolean {
		if (payLen < 24 || pb + payLen > msg.length) return false
		const subId = msg.readUInt16BE(pb)
		const output = this.imageStoreSubscriptionIds.get(subId)
		if (!output || msg.readUInt16BE(pb + 8) !== 5936) return false
		if (msg.readUInt32BE(pb + 12) !== 0x43000010 + output) return false
		const image = msg.readUInt32BE(pb + 20)
		if (image < 1 || image > 8999) return false
		if (this.imageStoreState.get(output) !== image) {
			this.imageStoreState.set(output, image)
			this.emitter.emit('imageStoreStateChanged', { origin: 'frame', output, image })
		}
		return true
	}

	subscribeToTransitionTelemetry(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) return { success: false, message: 'Not connected.' }
		if (this.transitionTelemetrySubscribed)
			return { success: true, message: 'Already subscribed to transition telemetry.' }
		const meIndexes = [0, 1, 2, 3, 4]
		const requests = meIndexes
			.flatMap((index) => [0x03000000 + index, 0x03000010 + index])
			.flatMap((did) => [4454, 4458, 4459].map((pid): ParameterTarget => ({ did, pid })))
		let index = 0
		const sendNext = () => {
			if (this.isClosing || index >= requests.length) {
				if (index >= requests.length) this.transitionTelemetrySubscribed = true
				return
			}
			const request = requests[index++]
			const { packet, subId } = this.buildParameterSubscriptionPacket(request.pid, request.did)
			this.transitionSubscriptionIds.set(subId, request)
			this.sendToFrame(packet)
			setTimeout(sendNext, 20)
		}
		sendNext()
		return { success: true, message: 'Transition telemetry subscription in progress.' }
	}

	parseTransitionTelemetryResponse(msg: Buffer, pb: number, payLen: number): boolean {
		if (payLen < 21 || pb + payLen > msg.length) return false
		const subId = msg.readUInt16BE(pb)
		const expected = this.transitionSubscriptionIds.get(subId)
		if (!expected || msg.readUInt16BE(pb + 8) !== expected.pid || msg.readUInt32BE(pb + 12) !== expected.did)
			return false
		const previous: TransitionTelemetryState = this.transitionTelemetry.get(expected.did) ?? {
			ramp: 0,
			effectiveRate: 1,
			active: false,
			direction: null,
		}
		const next = { ...previous }
		if (expected.pid === 4454) {
			if (payLen < 24) return false
			const ramp = Math.max(0, Math.min(1, msg.readFloatBE(pb + 20)))
			if (ramp > previous.ramp + 0.0001) next.direction = 'up'
			else if (ramp < previous.ramp - 0.0001) next.direction = 'down'
			next.ramp = ramp
		} else if (expected.pid === 4458) {
			if (payLen < 24) return false
			next.effectiveRate = Math.max(0, msg.readFloatBE(pb + 20))
		} else if (expected.pid === 4459) {
			next.active = payLen >= 24 ? msg.readUInt32BE(pb + 20) !== 0 : msg[pb + 20] !== 0
		}
		if (
			next.ramp !== previous.ramp ||
			next.effectiveRate !== previous.effectiveRate ||
			next.active !== previous.active ||
			next.direction !== previous.direction
		) {
			this.transitionTelemetry.set(expected.did, next)
			this.emitter.emit('transitionTelemetryChanged', { origin: 'frame', did: expected.did, ...next })
		}
		return true
	}

	/**
	 * Subscribe to AUX bus source selection updates.
	 * Sends 96 individual subscription packets (one per AUX bus, 0x00-0x5f).
	 * Pauses 5ms every 16 packets to prevent UDP flooding.
	 */
	subscribeToAuxBus(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		// Only subscribe once per connection
		if (this.subscribedAuxes.has('all')) {
			return { success: true, message: 'Already subscribed to AUX bus.' }
		}

		try {
			// Send one packet per 50ms to avoid CPLScheduler buffer overflow
			let busIdx = 0
			const sendNext = () => {
				if (this.isClosing || busIdx >= 96) {
					if (busIdx >= 96) {
						this.subscribedAuxes.add('all')
						this.emitter.emit('status', 'AUX_SUBSCRIBED', `Subscribed to all 96 AUX buses`)
					}
					return
				}
				const { packet } = this.buildAuxSubscriptionPacket(busIdx)
				this.sendToFrame(packet)
				busIdx++
				setTimeout(sendNext, 50)
			}
			sendNext()
			return { success: true, message: 'AUX subscription in progress (96 buses)' }
		} catch (error) {
			return { success: false, message: `Error creating subscription: ${errorMessage(error)}` }
		}
	}

	/**
	 * Subscribe to 20 A-D bus and 30 K1-K6 source selections across five MEs.
	 * Sends one read-only subscription every 50ms on either transport.
	 */
	subscribeToMEBus(): CommandResult {
		if (this.isClosing || this.mainHandshakeStage !== 9) {
			return { success: false, message: 'Not connected.' }
		}

		if (this.subscribedMEs.has('all')) {
			return { success: true, message: 'Already subscribed to ME bus.' }
		}

		try {
			// Subscribe to 20 A-D buses and 30 keyer source selections in one paced queue.
			const addresses: { address: number; keyer: boolean }[] = []
			for (let busCode = 0; busCode <= 3; busCode++) {
				// A=0, B=1, C=2, D=3
				for (let meNum = 0; meNum <= 4; meNum++) {
					// ME1=0, ME2=1, ME3=2, PGM=3, ME4=4
					addresses.push({ address: (busCode << 4) | meNum, keyer: false })
				}
			}

			for (let key = 0; key < 6; key++) {
				for (let me = 0; me < 5; me++) {
					addresses.push({ address: (key << 4) | me, keyer: true })
				}
			}
			this.subscribedMEs.add('all') // Prevent duplicate queues while subscriptions are pending.

			// Send one packet per 50ms to avoid CPLScheduler buffer overflow
			let idx = 0
			const sendNext = () => {
				if (this.isClosing || idx >= addresses.length) {
					if (idx >= addresses.length) {
						this.subscribedMEs.add('all')
						this.emitter.emit('status', 'ME_SUBSCRIBED', `Subscribed to 20 ME buses and 30 keyer sources`)
					}
					return
				}
				const { address, keyer } = addresses[idx]
				const { packet } = keyer
					? this.buildParameterSubscriptionPacket(0x103a, 0x08000000 + address)
					: this.buildMESubscriptionPacket(address)
				this.sendToFrame(packet)
				idx++
				setTimeout(sendNext, 50)
			}
			sendNext()
			return { success: true, message: 'ME subscription in progress (20 buses, 30 keyer sources)' }
		} catch (error) {
			return { success: false, message: `Error creating ME subscription: ${errorMessage(error)}` }
		}
	}

	/**
	 * Parse incoming subscription data packets.
	 *
	 * The frame packs multiple responses into a single UDP packet.
	 * Outer structure: [0-1] cmd_type, [2-3] sequence, [4+] N packed responses.
	 * Each packed response: [+0-1] sub_cmd, [+2-3] resp_type, [+4-7] pay_len,
	 *   [+8-11] sec_len, [+12..] payload (pay_len bytes).
	 * Stride to next response = 12 + pay_len.
	 *
	 * Dispatch by subscription type:
	 *   - pb+0 == 0x0210 → source definitions (not yet handled)
	 *   - pb+0 == 0x020b → source names (not yet handled)
	 *   - pb+8 == 0x104a, pb+12 == 0x19 → AUX response
	 *   - pb+8 == 0x104a, pb+12 == 0x04 → ME Bus response (logged only)
	 */
	handleSubscriptionData(msg: Buffer): void {
		if (msg.length < 8) return

		try {
			let offset = 4 // Skip outer header (cmd_type + sequence)

			while (offset + 12 <= msg.length) {
				// const subCmd = msg.readUInt16BE(offset);
				const respType = msg.readUInt16BE(offset + 2)
				const payLen = msg.readUInt32BE(offset + 4)
				// const secLen = msg.readUInt32BE(offset + 8);

				if (offset + 12 + payLen > msg.length) break // Truncated packet

				if (respType === 0x0010 && payLen >= 16) {
					const pb = offset + 12 // Payload base

					// Dispatch by subscription type
					const firstWord = msg.readUInt16BE(pb)

					if (this.timelineSubscriptionIds.has(firstWord)) {
						this.parseTimelineParameterResponse(msg, pb, payLen)
					} else if (firstWord === this.timelineKeyframeSubscriptionId) {
						this.parseTimelineKeyframeResponse(msg, pb, payLen)
					} else if (this.imageStoreSubscriptionIds.has(firstWord)) {
						this.parseImageStoreParameterResponse(msg, pb, payLen)
					} else if (this.transitionSubscriptionIds.has(firstWord)) {
						this.parseTransitionTelemetryResponse(msg, pb, payLen)
					} else if (firstWord === 0x0210) {
						// Source definition response — engineering names
						this.parseSourceDefResponse(msg, pb, payLen)
					} else if (firstWord === 0x020b) {
						// Source name response — operator-customized names (OLED, panel, menu)
						this.parseSourceNameResponse(msg, pb, payLen)
					} else if (firstWord === 0x0208) {
						// Macro catalog response (TCP/V16+) — address-based entries
						if (this.macroCatalogSubscribed) {
							const payload = msg.slice(pb, pb + payLen)
							const found = this.parseMacroCatalogData(payload)
							if (found > 0) {
								this.macroCatalogDataSeen = true
								this.stopMacroCatalogRetryLoop()
								this.resetMacroCatalogBulkTimer()
							}
						}
					} else if (firstWord === 0x020f) {
						if (this.macroCatalogSubscribed) {
							const found = this.parseMacroCatalogDataV14(msg, pb, payLen)
							if (found > 0) {
								this.macroCatalogDataSeen = true
								this.stopMacroCatalogRetryLoop()
								this.resetMacroCatalogBulkTimer()
							}
						}
					} else if (firstWord === 0x0234 || firstWord === 0x0235) {
						if (this.macroStatusSubscribed) {
							this.parseMacroStatusData(msg, pb, payLen)
						}
					} else {
						// AUX/ME response: signature at pb+8, marker at pb+12
						const signature = msg.readUInt16BE(pb + 8)
						const marker = msg[pb + 12]

						if (signature === 0x104a && marker === 0x19 && payLen >= 22) {
							// AUX response
							const bus = msg[pb + 15] // Bus index (0-95)
							const sourceNum = msg.readUInt16BE(pb + 20) // Source value
							const auxNum = bus + 1 // Convert to 1-based

							if (auxNum >= 1 && auxNum <= 96 && sourceNum > 0) {
								const previousSource = this.auxState.get(auxNum) || null

								if (previousSource !== sourceNum) {
									this.auxState.set(auxNum, sourceNum)
									this.emitter.emit('auxStateChanged', {
										origin: 'frame',
										auxNum,
										previousSource,
										currentSource: sourceNum,
									})
								}
							}
						} else if (signature === 0x103a && marker === 0x08 && payLen >= 22) {
							const address = msg.readUInt32BE(pb + 12) - 0x08000000
							const source = msg.readUInt16BE(pb + 20)
							const me = address & 0x0f
							const key = address >> 4
							if (address >= 0 && me <= 4 && key <= 5 && source <= 809) {
								const previousSource = this.keyerState.get(address) ?? null
								if (previousSource !== source) {
									this.keyerState.set(address, source)
									this.emitter.emit('meStateChanged', {
										origin: 'frame',
										kind: 'keyer',
										address,
										previousSource,
										currentSource: source,
									})
								}
							}
						} else if (signature === 0x104a && marker === 0x04 && payLen >= 22) {
							// ME Bus response — track state and emit changes
							const addr = msg[pb + 15]
							const sourceNum = msg.readUInt16BE(pb + 20)

							if (sourceNum > 0) {
								const previousSource = this.meState.get(addr) || null

								if (previousSource !== sourceNum) {
									this.meState.set(addr, sourceNum)
									this.emitter.emit('meStateChanged', {
										origin: 'frame',
										address: addr,
										previousSource,
										currentSource: sourceNum,
									})
								}
							}
						}
					}
				}

				offset += 12 + payLen
			}
		} catch (e) {
			this.emitter.emit('status', 'SUB_PARSE_ERROR', errorMessage(e))
		}
	}

	/**
	 * Parse 0x020b source name response.
	 * Records contain source ID + 6 null-terminated strings (OLED, short, eng, panel, menu, unused).
	 * Record wrappers: 12 bytes (range_start[4] + range_end[4] + prefix[2] + record_length[2]).
	 */
	parseSourceNameResponse(msg: Buffer, pb: number, payLen: number): void {
		let namesUpdated = 0
		try {
			// Records start at pb + 16 (after the 16-byte response header area)
			let pos = pb + 16
			const endPos = pb + payLen

			while (pos + 12 <= endPos) {
				// Record wrapper
				// const rangeStart = msg.readUInt32BE(pos);
				// const rangeEnd = msg.readUInt32BE(pos + 4);
				const prefix = msg.readUInt16BE(pos + 8)
				const recLen = msg.readUInt16BE(pos + 10)
				pos += 12

				// Null sentinel: skip
				if (prefix === 0x0000 && recLen === 0) continue
				// Terminator: stop
				if (prefix === 0x0004) break
				// Validate record length
				if (recLen === 0 || pos + recLen > endPos) break

				const recEnd = pos + recLen

				// Record data: sourceId(2) + properties(6) + flag(1) + 6 null-terminated strings
				if (recLen < 9) {
					pos = recEnd
					continue
				} // Too short

				const sourceId = msg.readUInt16BE(pos)
				// Skip properties (6 bytes) and flag (1 byte)
				let strPos = pos + 9 // Start of first string

				// Read 6 null-terminated strings
				const strings: string[] = []
				for (let s = 0; s < 6 && strPos < recEnd; s++) {
					const nullIdx = msg.indexOf(0x00, strPos)
					const end = nullIdx >= 0 && nullIdx < recEnd ? nullIdx : recEnd
					strings.push(msg.slice(strPos, end).toString('ascii'))
					strPos = end + 1 // Skip past the null terminator
				}

				// Pad with empty strings if fewer than 6 found
				while (strings.length < 6) strings.push('')

				const entry: SourceNameEntry = {
					oled: strings[0],
					short: strings[1],
					eng: strings[2],
					panel: strings[3],
					menu: strings[4],
				}

				// Full replace for 0x020b, but preserve eng from 0x0210 if this one is empty
				const existing = this.sourceNames.get(sourceId)
				if (existing && !entry.eng && existing.eng) {
					entry.eng = existing.eng
				}

				this.sourceNames.set(sourceId, entry)
				namesUpdated++

				pos = recEnd
			}
		} catch {
			// A malformed record ends parsing; names decoded before it are kept and published.
		}

		if (namesUpdated > 0) {
			this.emitter.emit('sourceNamesUpdated', { count: this.sourceNames.size })
		}
	}

	/**
	 * Parse 0x0210 source definition response.
	 * Records contain source ID + engineering name (near end of record).
	 * Only merges the eng field — does not overwrite OLED/panel/menu from 0x020b.
	 */
	parseSourceDefResponse(msg: Buffer, pb: number, payLen: number): void {
		let defsUpdated = 0
		try {
			let pos = pb + 16
			const endPos = pb + payLen

			while (pos + 12 <= endPos) {
				// Record wrapper
				const prefix = msg.readUInt16BE(pos + 8)
				const recLen = msg.readUInt16BE(pos + 10)
				pos += 12

				if (prefix === 0x0000 && recLen === 0) continue
				if (prefix === 0x0004) break
				if (recLen === 0 || pos + recLen > endPos) break

				const recEnd = pos + recLen

				if (recLen < 4) {
					pos = recEnd
					continue
				}

				const sourceId = msg.readUInt16BE(pos)

				// Engineering name: null-terminated string near the end of the record.
				// Start from the end, skip trailing nulls, then read backward to find the string start.
				let nameEnd = recEnd
				while (nameEnd > pos + 2 && msg[nameEnd - 1] === 0x00) nameEnd--
				let nameStart = nameEnd
				while (nameStart > pos + 2 && msg[nameStart - 1] !== 0x00) nameStart--

				const engName = nameEnd > nameStart ? msg.slice(nameStart, nameEnd).toString('ascii') : ''

				if (engName && sourceId > 0) {
					const existing = this.sourceNames.get(sourceId) || { oled: '', short: '', eng: '', panel: '', menu: '' }
					existing.eng = engName
					this.sourceNames.set(sourceId, existing)
					defsUpdated++
				}

				pos = recEnd
			}
		} catch {
			// A malformed record ends parsing; names decoded before it are kept and published.
		}

		if (defsUpdated > 0) {
			this.emitter.emit('sourceNamesUpdated', { count: this.sourceNames.size })
		}
	}

	/**
	 * Get source name entry for a specific source number
	 * @returns {{ oled: string, short: string, eng: string, panel: string, menu: string } | null}
	 */
	getSourceName(sourceNum: number): SourceNameEntry | null {
		return this.sourceNames.get(sourceNum) || null
	}

	/**
	 * Get every cached source name as a detached, source-number-sorted list.
	 */
	getSourceNames(): (SourceNameEntry & { id: number })[] {
		return Array.from(this.sourceNames.entries())
			.sort(([a], [b]) => a - b)
			.map(([id, names]) => ({ id, ...names }))
	}

	/**
	 * Resolve a source number to the best display name.
	 * Priority: menu > oled > panel > eng. Returns null if no name found (caller falls back to hardcoded).
	 */
	resolveSourceDisplayName(sourceNum: number): string | null {
		const names = this.sourceNames.get(sourceNum)
		if (names) {
			if (names.menu) return names.menu
			if (names.oled) return names.oled
			if (names.panel) return names.panel
			if (names.eng) return names.eng
		}
		return null
	}

	/**
	 * Get current source on a specific AUX bus
	 */
	getAuxSource(auxNum: number): number | null {
		return this.auxState.get(auxNum) || null
	}

	// ─── ME Bus Query Methods ─────────────────────────────────────────

	/**
	 * Get current source on a specific ME bus
	 * @param {number} address - ME address byte: (bus_code << 4) | me_num
	 */
	getKeyerSource(address: number): number | null {
		return this.keyerState.get(address) ?? null
	}

	getMESource(address: number): number | null {
		return this.meState.get(address) || null
	}

	getTimelineState(): TimelineState {
		return { ...this.timelineState, pausePoints: [...this.timelineState.pausePoints] }
	}

	getImageStoreImage(output: number): number | null {
		return this.imageStoreState.get(output) ?? null
	}

	getTransitionTelemetry(did: number): TransitionTelemetryState | null {
		const state = this.transitionTelemetry.get(did)
		return state ? { ...state } : null
	}
}

export = HandshakeConnection
