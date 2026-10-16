// @ts-nocheck
// Connection Manager - manages multiple simultaneous handshake connections
const EventEmitter = require('events')
const HandshakeConnection = require('./handshake-connection-class.cjs')

class ConnectionManager {
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
	async createConnection(connectionId, targetHost, suite, customPorts, suiteName, moduleVersion, buildDate) {
		// Serialise replace-and-register per id so a concurrent create cannot be
		// overwritten (and orphaned) while an older one awaits its disconnect.
		const previous = this.pendingCreates.get(connectionId) ?? Promise.resolve()
		let release
		const gate = new Promise((resolve) => {
			release = resolve
		})
		this.pendingCreates.set(connectionId, gate)
		let connection
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

	registerConnection(connectionId, targetHost, suite, customPorts, suiteName, moduleVersion, buildDate) {
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
		connection.emitter.on('status', (type, message) => {
			// Emit with connectionId so listeners know which connection this is for
			if (this.connections.get(connectionId) === connection) this.emitter.emit('status', connectionId, type, message)
		})

		// Forward AUX state change events
		connection.emitter.on('auxStateChanged', (data) => {
			this.emitter.emit('auxStateChanged', connectionId, data)
		})

		// Forward ME state change events
		connection.emitter.on('meStateChanged', (data) => {
			this.emitter.emit('meStateChanged', connectionId, data)
		})

		connection.emitter.on('timelineStateChanged', (data) => {
			this.emitter.emit('timelineStateChanged', connectionId, data)
		})

		connection.emitter.on('imageStoreStateChanged', (data) => {
			this.emitter.emit('imageStoreStateChanged', connectionId, data)
		})

		connection.emitter.on('transitionTelemetryChanged', (data) => {
			this.emitter.emit('transitionTelemetryChanged', connectionId, data)
		})

		// Forward source name update events
		connection.emitter.on('sourceNamesUpdated', (data) => {
			this.emitter.emit('sourceNamesUpdated', connectionId, data)
		})

		// Store connection
		this.connections.set(connectionId, connection)
		return connection
	}

	/**
	 * Disconnect a specific connection
	 */
	async disconnectConnection(connectionId) {
		const connection = this.connections.get(connectionId)
		if (connection) {
			const sockets = [connection.tcpSocket, connection.mainClient, connection.listenerClient].filter(Boolean)
			const closed = sockets.map(
				(socket) =>
					new Promise((resolve) => {
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
	getConnection(connectionId) {
		return this.connections.get(connectionId)
	}

	/**
	 * Get all active connection IDs
	 */
	getActiveConnections() {
		return Array.from(this.connections.keys())
	}

	/**
	 * Send a macro command to a specific connection
	 */
	sendMacro(connectionId, macroNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendMacro(macroNum)
	}

	sendMacroStop(connectionId, macroNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendMacroStop(macroNum)
	}

	sendMacroStopAll(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendMacroStopAll()
	}

	/**
	 * Send an aux routing command to a specific connection
	 */
	sendAuxRoute(connectionId, auxNum, sourceNum, transitionType = 'cut') {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendAuxRoute(auxNum, sourceNum, transitionType)
	}

	/**
	 * Send an image store command to a specific connection
	 */
	sendImageStore(connectionId, outputNum, imageNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendImageStore(outputNum, imageNum)
	}

	/**
	 * Send an image store input command to a specific connection
	 */
	sendImageStoreInput(connectionId, inputNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendImageStoreInput(inputNum)
	}

	sendEMem(connectionId, eMemNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendEMem(eMemNum)
	}

	sendCrosspoint(connectionId, pid, did, sourceNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendCrosspoint(pid, did, sourceNum)
	}

	sendTransitionEvent(connectionId, eid, did) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendTransitionEvent(eid, did)
	}

	sendEMemTargeted(connectionId, eMemNum, did, mode) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendEMemTargeted(eMemNum, did, mode)
	}

	/**
	 * Send a raw hex command to a specific connection
	 */
	sendRawCommand(connectionId, hexCommand) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendRawCommand(hexCommand)
	}

	/**
	 * Send a panel memory command to a specific connection
	 */
	sendPanelMem(connectionId, panelMemNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.sendPanelMem(panelMemNum)
	}

	/**
	 * Get connection info for UI display
	 */
	getConnectionInfo(connectionId) {
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
	getMacroName(connectionId, macroNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroName(macroNum)
	}

	/**
	 * Get full macro catalog for a connection
	 */
	getMacroCatalog(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroCatalog()
	}

	/**
	 * Get macro run-state for a connection
	 * Returns { macroStatus: {macroNum: eMacroStatus}, lastPlayedMacro, runSeq }
	 */
	getMacroRunState(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroRunState()
	}

	/**
	 * Get status of a specific macro (null if not active)
	 */
	getMacroStatus(connectionId, macroNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMacroStatusForMacro(macroNum)
	}

	/**
	 * Subscribe to AUX bus source selection for a connection
	 */
	subscribeToAuxBus(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.subscribeToAuxBus()
	}

	/**
	 * Get current source on a specific AUX bus
	 */
	getAuxSource(connectionId, auxNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getAuxSource(auxNum)
	}

	/**
	 * Subscribe to ME bus source selection for a connection
	 */
	subscribeToMEBus(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.subscribeToMEBus()
	}

	/**
	 * Get current source on a specific ME bus
	 */
	getKeyerSource(connectionId, address) {
		return this.connections.get(connectionId)?.getKeyerSource(address) ?? null
	}

	getMESource(connectionId, address) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getMESource(address)
	}

	getTimelineState(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getTimelineState()
	}

	subscribeToMasterTimeline(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.subscribeToMasterTimeline()
	}

	subscribeToImageStore(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.subscribeToImageStore()
	}

	getImageStoreImage(connectionId, output) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getImageStoreImage(output)
	}

	subscribeToTransitionTelemetry(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.subscribeToTransitionTelemetry()
	}

	getTransitionTelemetry(connectionId, did) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.getTransitionTelemetry(did)
	}

	sendTimelineEvent(connectionId, eid, did, data) {
		const connection = this.connections.get(connectionId)
		if (!connection) return { success: false, message: `No connection found: ${connectionId}` }
		return connection.sendTimelineEvent(eid, did, data)
	}

	/**
	 * Subscribe to source names (0x0210 + 0x020b) for a connection
	 */
	subscribeToSourceNames(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) {
			return { success: false, message: `No connection found: ${connectionId}` }
		}
		return connection.subscribeToSourceNames()
	}

	getSourceNames(connectionId) {
		const connection = this.connections.get(connectionId)
		if (!connection) return []
		return connection.getSourceNames()
	}

	/**
	 * Resolve a source number to the best display name (menu > oled > panel > eng)
	 * Returns null if no name found - caller should fall back to hardcoded labels
	 */
	resolveSourceDisplayName(connectionId, sourceNum) {
		const connection = this.connections.get(connectionId)
		if (!connection) return null
		return connection.resolveSourceDisplayName(sourceNum)
	}
}

// Create singleton instance
const connectionManager = new ConnectionManager()

// Export both the class and singleton
module.exports = {
	ConnectionManager,
	connectionManager,
	// Convenience exports
	createConnection: (id, host, suite, ports, suiteName, moduleVersion, buildDate) =>
		connectionManager.createConnection(id, host, suite, ports, suiteName, moduleVersion, buildDate),
	disconnectConnection: (id) => connectionManager.disconnectConnection(id),
	getConnection: (id) => connectionManager.getConnection(id),
	sendMacro: (id, macroNum) => connectionManager.sendMacro(id, macroNum),
	sendMacroStop: (id, macroNum) => connectionManager.sendMacroStop(id, macroNum),
	sendMacroStopAll: (id) => connectionManager.sendMacroStopAll(id),
	sendAuxRoute: (id, auxNum, sourceNum, transitionType) =>
		connectionManager.sendAuxRoute(id, auxNum, sourceNum, transitionType),
	sendImageStore: (id, outputNum, imageNum) => connectionManager.sendImageStore(id, outputNum, imageNum),
	sendImageStoreInput: (id, inputNum) => connectionManager.sendImageStoreInput(id, inputNum),
	sendEMem: (id, eMemNum) => connectionManager.sendEMem(id, eMemNum),
	sendCrosspoint: (id, pid, did, sourceNum) => connectionManager.sendCrosspoint(id, pid, did, sourceNum),
	sendTransitionEvent: (id, eid, did) => connectionManager.sendTransitionEvent(id, eid, did),
	sendEMemTargeted: (id, eMemNum, did, mode) => connectionManager.sendEMemTargeted(id, eMemNum, did, mode),
	sendRawCommand: (id, hexCommand) => connectionManager.sendRawCommand(id, hexCommand),
	sendPanelMem: (id, panelMemNum) => connectionManager.sendPanelMem(id, panelMemNum),
	getMacroName: (id, macroNum) => connectionManager.getMacroName(id, macroNum),
	getMacroCatalog: (id) => connectionManager.getMacroCatalog(id),
	getMacroRunState: (id) => connectionManager.getMacroRunState(id),
	getMacroStatus: (id, macroNum) => connectionManager.getMacroStatus(id, macroNum),
	subscribeToAuxBus: (id) => connectionManager.subscribeToAuxBus(id),
	getAuxSource: (id, auxNum) => connectionManager.getAuxSource(id, auxNum),
	subscribeToMEBus: (id) => connectionManager.subscribeToMEBus(id),
	getKeyerSource: (id, address) => connectionManager.getKeyerSource(id, address),
	getMESource: (id, address) => connectionManager.getMESource(id, address),
	getTimelineState: (id) => connectionManager.getTimelineState(id),
	subscribeToMasterTimeline: (id) => connectionManager.subscribeToMasterTimeline(id),
	subscribeToImageStore: (id) => connectionManager.subscribeToImageStore(id),
	getImageStoreImage: (id, output) => connectionManager.getImageStoreImage(id, output),
	subscribeToTransitionTelemetry: (id) => connectionManager.subscribeToTransitionTelemetry(id),
	getTransitionTelemetry: (id, did) => connectionManager.getTransitionTelemetry(id, did),
	sendTimelineEvent: (id, eid, did, data) => connectionManager.sendTimelineEvent(id, eid, did, data),
	subscribeToSourceNames: (id) => connectionManager.subscribeToSourceNames(id),
	getSourceNames: (id) => connectionManager.getSourceNames(id),
	resolveSourceDisplayName: (id, sourceNum) => connectionManager.resolveSourceDisplayName(id, sourceNum),
	getConnectionInfo: (id) => connectionManager.getConnectionInfo(id),
	getActiveConnections: () => connectionManager.getActiveConnections(),
	clientEmitter: connectionManager.emitter,
}
