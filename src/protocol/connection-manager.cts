// Connection Manager - manages multiple simultaneous handshake connections
import EventEmitter = require('events')
import HandshakeConnection = require('./handshake-connection-class.cjs')

type ConnectionPorts = ConstructorParameters<typeof HandshakeConnection>[3]
type FrameSocket = NonNullable<HandshakeConnection['tcpSocket'] | HandshakeConnection['mainClient']>
type MacroCatalog = ReturnType<HandshakeConnection['getMacroCatalog']>
type MacroRunState = ReturnType<HandshakeConnection['getMacroRunState']>
type TimelineState = ReturnType<HandshakeConnection['getTimelineState']>
type TransitionTelemetry = NonNullable<ReturnType<HandshakeConnection['getTransitionTelemetry']>>
type SourceNameRecord = ReturnType<HandshakeConnection['getSourceNames']>[number]

/** Snapshot of one connection for UI display. */
interface ConnectionInfo {
	id: string
	suite: string
	host: string
	ports: { main: number; listener: number; dynamic: number }
	stage: number
	connected: boolean
	fullyConnected: boolean
	protocol: HandshakeConnection['protocol']
	frameVersion: string | null
}

/** Result returned when no connection exists for the id; matches HandshakeConnection's results. */
interface CommandResult {
	success: boolean
	message: string
}

class ConnectionManager {
	connections: Map<string, HandshakeConnection>
	pendingCreates: Map<string, Promise<void>>
	emitter: EventEmitter

	constructor() {
		this.connections = new Map() // connectionId -> HandshakeConnection
		this.pendingCreates = new Map() // connectionId -> gate for the latest create
		this.emitter = new EventEmitter()
	}

	/**
	 * Create a new connection
	 * @param {string} connectionId - Unique identifier (e.g., suite name or context ID)
	 * @param {string} targetHost - IP address
	 * @param {string} suite - Suite identifier (suite1a to suite4a)
	 * @param {object} customPorts - { mainPort, listenerPort }
	 * @returns {Promise<function>} Cleanup function
	 */
	async createConnection(
		connectionId: string,
		targetHost: string,
		suite: string,
		customPorts?: ConnectionPorts,
		suiteName?: string,
		moduleVersion?: string,
		buildDate?: string,
	): Promise<() => void> {
		// Serialise replace-and-register per id so a concurrent create cannot be
		// overwritten (and orphaned) while an older one awaits its disconnect.
		const previous = this.pendingCreates.get(connectionId) ?? Promise.resolve()
		const { promise: gate, resolve: release } = Promise.withResolvers<void>()
		this.pendingCreates.set(connectionId, gate)
		let connection: HandshakeConnection
		try {
			await previous
			// Close existing connection if it exists
			if (this.connections.has(connectionId)) {
				await this.disconnectConnection(connectionId)
			}
			connection = this.registerConnection(
				connectionId,
				targetHost,
				suite,
				customPorts,
				suiteName,
				moduleVersion,
				buildDate,
			)
		} finally {
			if (this.pendingCreates.get(connectionId) === gate) this.pendingCreates.delete(connectionId)
			release()
		}

		try {
			// Start the connection
			const cleanup = await connection.start()
			return cleanup
		} catch (error) {
			connection.cleanup()
			// An older cancelled attempt must not delete a replacement connection.
			if (this.connections.get(connectionId) === connection) this.connections.delete(connectionId)
			throw error
		}
	}

	registerConnection(
		connectionId: string,
		targetHost: string,
		suite: string,
		customPorts?: ConnectionPorts,
		suiteName?: string,
		moduleVersion?: string,
		buildDate?: string,
	): HandshakeConnection {
		// Create new connection instance
		const connection = new HandshakeConnection(
			connectionId,
			targetHost,
			suite,
			customPorts,
			suiteName,
			moduleVersion,
			buildDate,
		)

		// Forward events from connection to manager emitter
		connection.emitter.on('status', (type: string, message: unknown) => {
			// Emit with connectionId so listeners know which connection this is for
			if (this.connections.get(connectionId) === connection) this.emitter.emit('status', connectionId, type, message)
		})

		// Forward AUX state change events
		connection.emitter.on('auxStateChanged', (data: unknown) => {
			this.emitter.emit('auxStateChanged', connectionId, data)
		})

		// Forward ME state change events
		connection.emitter.on('meStateChanged', (data: unknown) => {
			this.emitter.emit('meStateChanged', connectionId, data)
		})

		connection.emitter.on('timelineStateChanged', (data: unknown) => {
			this.emitter.emit('timelineStateChanged', connectionId, data)
		})

		connection.emitter.on('imageStoreStateChanged', (data: unknown) => {
			this.emitter.emit('imageStoreStateChanged', connectionId, data)
		})

		connection.emitter.on('transitionTelemetryChanged', (data: unknown) => {
			this.emitter.emit('transitionTelemetryChanged', connectionId, data)
		})

		// Forward source name update events
		connection.emitter.on('sourceNamesUpdated', (data: unknown) => {
			this.emitter.emit('sourceNamesUpdated', connectionId, data)
		})

		// Store connection
		this.connections.set(connectionId, connection)
		return connection
	}

	/**
	 * Disconnect a specific connection
	 */
	async disconnectConnection(connectionId: string): Promise<void> {
		const connection = this.connections.get(connectionId)
		if (connection) {
			const sockets = [connection.tcpSocket, connection.mainClient, connection.listenerClient].filter(
				(socket: FrameSocket | null): socket is FrameSocket => Boolean(socket),
			)
			const closed = sockets.map(
				// async still runs the executor (and registers 'close') synchronously, before cleanup().
				async (socket: EventEmitter) =>
					new Promise<void>((resolve) => {
						const timeout = setTimeout(resolve, 100)
						socket.once('close', () => {
							clearTimeout(timeout)
							resolve()
						})
					}),
			)
			connection.cleanup()
			this.connections.delete(connectionId)
			await Promise.all(closed)
		}
	}

	/**
	 * Get a connection by ID
	 */
	getConnection(connectionId: string): HandshakeConnection | undefined {
		return this.connections.get(connectionId)
	}

	/**
	 * Get all active connection IDs
	 */
	getActiveConnections(): string[] {
		return Array.from(this.connections.keys())
	}

	/**
	 * Send a macro command to a specific connection
	 */
	sendMacro(connectionId: string, macroNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendMacro(macroNum)
	}

	sendMacroStop(connectionId: string, macroNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendMacroStop(macroNum)
	}

	sendMacroStopAll(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendMacroStopAll()
	}

	/**
	 * Send an aux routing command to a specific connection
	 */
	sendAuxRoute(connectionId: string, auxNum: number, sourceNum: number, transitionType = 'cut'): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendAuxRoute(auxNum, sourceNum, transitionType)
	}

	/**
	 * Send an image store command to a specific connection
	 */
	sendImageStore(connectionId: string, outputNum: number, imageNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendImageStore(outputNum, imageNum)
	}

	/**
	 * Send an image store input command to a specific connection
	 */
	sendImageStoreInput(connectionId: string, inputNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendImageStoreInput(inputNum)
	}

	sendEMem(connectionId: string, eMemNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendEMem(eMemNum)
	}

	sendCrosspoint(connectionId: string, pid: number, did: number, sourceNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendCrosspoint(pid, did, sourceNum)
	}

	sendTransitionEvent(connectionId: string, eid: number, did: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendTransitionEvent(eid, did)
	}

	sendEMemTargeted(connectionId: string, eMemNum: number, did: number, mode: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendEMemTargeted(eMemNum, did, mode)
	}

	/**
	 * Send a raw hex command to a specific connection
	 */
	sendRawCommand(connectionId: string, hexCommand: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendRawCommand(hexCommand)
	}

	/**
	 * Send a panel memory command to a specific connection
	 */
	sendPanelMem(connectionId: string, panelMemNum: number): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendPanelMem(panelMemNum)
	}

	/**
	 * Get connection info for UI display
	 */
	getConnectionInfo(connectionId: string): ConnectionInfo | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null

		return {
			id: connectionId,
			suite: connection.suite,
			host: connection.targetHost,
			ports: {
				main: connection.mainClientPort,
				listener: connection.listenerClientPort,
				dynamic: connection.secondPhaseDynamicCommPort,
			},
			stage: connection.mainHandshakeStage,
			connected: connection.mainHandshakeStage === 9 && !connection.isClosing,
			fullyConnected: connection.fullyConnected, // Only true after CONNECTED event
			protocol: connection.protocol || 'udp',
			frameVersion: connection.frameVersion || null,
		}
	}

	/**
	 * Get macro name (OLED) for a specific macro number
	 */
	getMacroName(connectionId: string, macroNum: number): string | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroName(macroNum)
	}

	/**
	 * Get full macro catalog for a connection
	 */
	getMacroCatalog(connectionId: string): MacroCatalog | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroCatalog()
	}

	/**
	 * Get macro run-state for a connection
	 * Returns { macroStatus: {macroNum: eMacroStatus}, lastPlayedMacro, runSeq }
	 */
	getMacroRunState(connectionId: string): MacroRunState | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroRunState()
	}

	/**
	 * Get status of a specific macro (null if not active)
	 */
	getMacroStatus(connectionId: string, macroNum: number): number | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroStatusForMacro(macroNum)
	}

	/**
	 * Subscribe to AUX bus source selection for a connection
	 */
	subscribeToAuxBus(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.subscribeToAuxBus()
	}

	/**
	 * Get current source on a specific AUX bus
	 */
	getAuxSource(connectionId: string, auxNum: number): number | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getAuxSource(auxNum)
	}

	/**
	 * Subscribe to ME bus source selection for a connection
	 */
	subscribeToMEBus(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.subscribeToMEBus()
	}

	/**
	 * Get current source on a specific ME bus
	 */
	getKeyerSource(connectionId: string, address: number): number | null {
		return this.connections.get(connectionId)?.getKeyerSource(address) ?? null
	}

	getMESource(connectionId: string, address: number): number | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMESource(address)
	}

	getTimelineState(connectionId: string): TimelineState | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getTimelineState()
	}

	subscribeToMasterTimeline(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.subscribeToMasterTimeline()
	}

	subscribeToImageStore(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.subscribeToImageStore()
	}

	getImageStoreImage(connectionId: string, output: number): number | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getImageStoreImage(output)
	}

	subscribeToTransitionTelemetry(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.subscribeToTransitionTelemetry()
	}

	getTransitionTelemetry(connectionId: string, did: number): TransitionTelemetry | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getTransitionTelemetry(did)
	}

	sendTimelineEvent(connectionId: string, eid: number, did: number, data: number[]): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.sendTimelineEvent(eid, did, data)
	}

	/**
	 * Subscribe to source names (0x0210 + 0x020b) for a connection
	 */
	subscribeToSourceNames(connectionId: string): CommandResult {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.subscribeToSourceNames()
	}

	getSourceNames(connectionId: string): SourceNameRecord[] {
		const connection = this.connections.get(connectionId)
		if (!connection) return []
		return connection.getSourceNames()
	}

	/**
	 * Resolve a source number to the best display name (menu > oled > panel > eng)
	 * Returns null if no name found - caller should fall back to hardcoded labels
	 */
	resolveSourceDisplayName(connectionId: string, sourceNum: number): string | null {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.resolveSourceDisplayName(sourceNum)
	}
}

// Create singleton instance
const connectionManager = new ConnectionManager()

// Export both the class and singleton
export = {
	ConnectionManager,
	connectionManager,
	// Convenience exports
	createConnection: async (
		id: string,
		host: string,
		suite: string,
		ports?: ConnectionPorts,
		suiteName?: string,
		moduleVersion?: string,
		buildDate?: string,
	): Promise<() => void> =>
		connectionManager.createConnection(id, host, suite, ports, suiteName, moduleVersion, buildDate),
	disconnectConnection: async (id: string): Promise<void> => connectionManager.disconnectConnection(id),
	getConnection: (id: string): HandshakeConnection | undefined => connectionManager.getConnection(id),
	sendMacro: (id: string, macroNum: number): CommandResult => connectionManager.sendMacro(id, macroNum),
	sendMacroStop: (id: string, macroNum: number): CommandResult => connectionManager.sendMacroStop(id, macroNum),
	sendMacroStopAll: (id: string): CommandResult => connectionManager.sendMacroStopAll(id),
	sendAuxRoute: (id: string, auxNum: number, sourceNum: number, transitionType?: string): CommandResult =>
		connectionManager.sendAuxRoute(id, auxNum, sourceNum, transitionType),
	sendImageStore: (id: string, outputNum: number, imageNum: number): CommandResult =>
		connectionManager.sendImageStore(id, outputNum, imageNum),
	sendImageStoreInput: (id: string, inputNum: number): CommandResult =>
		connectionManager.sendImageStoreInput(id, inputNum),
	sendEMem: (id: string, eMemNum: number): CommandResult => connectionManager.sendEMem(id, eMemNum),
	sendCrosspoint: (id: string, pid: number, did: number, sourceNum: number): CommandResult =>
		connectionManager.sendCrosspoint(id, pid, did, sourceNum),
	sendTransitionEvent: (id: string, eid: number, did: number): CommandResult =>
		connectionManager.sendTransitionEvent(id, eid, did),
	sendEMemTargeted: (id: string, eMemNum: number, did: number, mode: number): CommandResult =>
		connectionManager.sendEMemTargeted(id, eMemNum, did, mode),
	sendRawCommand: (id: string, hexCommand: string): CommandResult => connectionManager.sendRawCommand(id, hexCommand),
	sendPanelMem: (id: string, panelMemNum: number): CommandResult => connectionManager.sendPanelMem(id, panelMemNum),
	getMacroName: (id: string, macroNum: number): string | null => connectionManager.getMacroName(id, macroNum),
	getMacroCatalog: (id: string): MacroCatalog | null => connectionManager.getMacroCatalog(id),
	getMacroRunState: (id: string): MacroRunState | null => connectionManager.getMacroRunState(id),
	getMacroStatus: (id: string, macroNum: number): number | null => connectionManager.getMacroStatus(id, macroNum),
	subscribeToAuxBus: (id: string): CommandResult => connectionManager.subscribeToAuxBus(id),
	getAuxSource: (id: string, auxNum: number): number | null => connectionManager.getAuxSource(id, auxNum),
	subscribeToMEBus: (id: string): CommandResult => connectionManager.subscribeToMEBus(id),
	getKeyerSource: (id: string, address: number): number | null => connectionManager.getKeyerSource(id, address),
	getMESource: (id: string, address: number): number | null => connectionManager.getMESource(id, address),
	getTimelineState: (id: string): TimelineState | null => connectionManager.getTimelineState(id),
	subscribeToMasterTimeline: (id: string): CommandResult => connectionManager.subscribeToMasterTimeline(id),
	subscribeToImageStore: (id: string): CommandResult => connectionManager.subscribeToImageStore(id),
	getImageStoreImage: (id: string, output: number): number | null => connectionManager.getImageStoreImage(id, output),
	subscribeToTransitionTelemetry: (id: string): CommandResult => connectionManager.subscribeToTransitionTelemetry(id),
	getTransitionTelemetry: (id: string, did: number): TransitionTelemetry | null =>
		connectionManager.getTransitionTelemetry(id, did),
	sendTimelineEvent: (id: string, eid: number, did: number, data: number[]): CommandResult =>
		connectionManager.sendTimelineEvent(id, eid, did, data),
	subscribeToSourceNames: (id: string): CommandResult => connectionManager.subscribeToSourceNames(id),
	getSourceNames: (id: string): SourceNameRecord[] => connectionManager.getSourceNames(id),
	resolveSourceDisplayName: (id: string, sourceNum: number): string | null =>
		connectionManager.resolveSourceDisplayName(id, sourceNum),
	getConnectionInfo: (id: string): ConnectionInfo | null => connectionManager.getConnectionInfo(id),
	getActiveConnections: (): string[] => connectionManager.getActiveConnections(),
	clientEmitter: connectionManager.emitter,
}
