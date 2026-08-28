// @ts-nocheck
// Connection Manager - manages multiple simultaneous handshake connections
const EventEmitter = require('events');
const HandshakeConnection = require('./handshake-connection-class.cjs');

class ConnectionManager {
    constructor() {
        this.connections = new Map(); // connectionId -> HandshakeConnection
        this.emitter = new EventEmitter();
        this.sdkGlobalSettings = null;
    }
    
    initialize(sdkSettings) {
        this.sdkGlobalSettings = sdkSettings;
    }
    
    /**
     * Create a new connection
     * @param {string} connectionId - Unique identifier (e.g., suite name or context ID)
     * @param {string} targetHost - IP address
     * @param {string} suite - Suite identifier (suite1a, suite2b, etc.)
     * @param {object} customPorts - { mainPort, listenerPort }
     * @returns {Promise<function>} Cleanup function
     */
    async createConnection(connectionId, targetHost, suite, customPorts, suiteName, pluginVersion, buildDate) {
        // Close existing connection if it exists
        if (this.connections.has(connectionId)) {
            await this.disconnectConnection(connectionId);
        }
        
        // Create new connection instance
        const connection = new HandshakeConnection(
            connectionId,
            targetHost,
            suite,
            customPorts,
            this.sdkGlobalSettings,
            suiteName,
            pluginVersion,
            buildDate
        );
        
        // Forward events from connection to manager emitter
        connection.emitter.on('status', (type, message) => {
            // Emit with connectionId so listeners know which connection this is for
            this.emitter.emit('status', connectionId, type, message);
        });

        // Forward AUX state change events
        connection.emitter.on('auxStateChanged', (data) => {
            this.emitter.emit('auxStateChanged', connectionId, data);
        });

        // Forward ME state change events
        connection.emitter.on('meStateChanged', (data) => {
            this.emitter.emit('meStateChanged', connectionId, data);
        });

        connection.emitter.on('timelineStateChanged', (data) => {
            this.emitter.emit('timelineStateChanged', connectionId, data);
        });

        connection.emitter.on('imageStoreStateChanged', (data) => {
            this.emitter.emit('imageStoreStateChanged', connectionId, data);
        });

        connection.emitter.on('transitionTelemetryChanged', (data) => {
            this.emitter.emit('transitionTelemetryChanged', connectionId, data);
        });

        // Forward source name update events
        connection.emitter.on('sourceNamesUpdated', (data) => {
            this.emitter.emit('sourceNamesUpdated', connectionId, data);
        });
        
        // Store connection
        this.connections.set(connectionId, connection);
        
        try {
            // Start the connection
            const cleanup = await connection.start();
            return cleanup;
        } catch (error) {
            this.connections.delete(connectionId);
            throw error;
        }
    }
    
    /**
     * Disconnect a specific connection
     */
    async disconnectConnection(connectionId) {
        const connection = this.connections.get(connectionId);
        if (connection) {
            const sockets = [connection.tcpSocket, connection.mainClient, connection.listenerClient].filter(Boolean);
            const closed = sockets.map((socket) => new Promise((resolve) => {
                const timeout = setTimeout(resolve, 100);
                socket.once('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            }));
            connection.cleanup();
            this.connections.delete(connectionId);
            await Promise.all(closed);
        }
    }
    
    /**
     * Get a connection by ID
     */
    getConnection(connectionId) {
        return this.connections.get(connectionId);
    }
    
    /**
     * Get all active connection IDs
     */
    getActiveConnections() {
        return Array.from(this.connections.keys());
    }
    
    /**
     * Check if a connection is active and connected
     */
    isConnected(connectionId) {
        const connection = this.connections.get(connectionId);
        return connection && connection.mainHandshakeStage === 9 && !connection.isClosing;
    }
    
    /**
     * Send a macro command to a specific connection
     */
    sendMacro(connectionId, macroNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendMacro(macroNum);
    }

    sendMacroStop(connectionId, macroNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendMacroStop(macroNum);
    }

    sendMacroStopAll(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendMacroStopAll();
    }
    
    /**
     * Send an aux routing command to a specific connection
     */
    sendAuxRoute(connectionId, auxNum, sourceNum, transitionType = 'cut') {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendAuxRoute(auxNum, sourceNum, transitionType);
    }
    
    /**
     * Send an image store command to a specific connection
     */
    sendImageStore(connectionId, outputNum, imageNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendImageStore(outputNum, imageNum);
    }
    
    /**
     * Send an image store input command to a specific connection
     */
    sendImageStoreInput(connectionId, inputNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendImageStoreInput(inputNum);
    }

    sendEMem(connectionId, eMemNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendEMem(eMemNum);
    }

    sendCrosspoint(connectionId, pid, did, sourceNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendCrosspoint(pid, did, sourceNum);
    }

    sendTransitionEvent(connectionId, eid, did) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendTransitionEvent(eid, did);
    }

    sendEMemTargeted(connectionId, eMemNum, did, mode) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendEMemTargeted(eMemNum, did, mode);
    }

    /**
     * Send a raw hex command to a specific connection
     */
    sendRawCommand(connectionId, hexCommand) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendRawCommand(hexCommand);
    }

    /**
     * Send a panel memory command to a specific connection
     */
    sendPanelMem(connectionId, panelMemNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.sendPanelMem(panelMemNum);
    }

    /**
     * Get connection info for UI display
     */
    getConnectionInfo(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        
        return {
            id: connectionId,
            suite: connection.suite,
            host: connection.targetHost,
            ports: {
                main: connection.mainClientPort,
                listener: connection.listenerClientPort,
                dynamic: connection.secondPhaseDynamicCommPort
            },
            stage: connection.mainHandshakeStage,
            connected: connection.mainHandshakeStage === 9 && !connection.isClosing,
            fullyConnected: connection.fullyConnected, // Only true after CONNECTED event
            protocol: connection.protocol || 'udp',
            frameVersion: connection.frameVersion || null
        };
    }
    
    /**
     * Get macro name (OLED) for a specific macro number
     */
    getMacroName(connectionId, macroNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getMacroName(macroNum);
    }

    /**
     * Get full macro catalog for a connection
     */
    getMacroCatalog(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getMacroCatalog();
    }

    /**
     * Get macro run-state for a connection
     * Returns { macroStatus: {macroNum: eMacroStatus}, lastPlayedMacro, runSeq }
     */
    getMacroRunState(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getMacroRunState();
    }

    /**
     * Get status of a specific macro (null if not active)
     */
    getMacroStatus(connectionId, macroNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getMacroStatusForMacro(macroNum);
    }

    /**
     * Subscribe to AUX bus source selection for a connection
     */
    subscribeToAuxBus(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.subscribeToAuxBus();
    }

    /**
     * Get current source on a specific AUX bus
     */
    getAuxSource(connectionId, auxNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getAuxSource(auxNum);
    }

    /**
     * Get all AUX state for a connection
     */
    getAllAuxState(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getAllAuxState();
    }

    /**
     * Check if a source is on any AUX bus (for low tally)
     */
    isSourceOnAnyAux(connectionId, sourceNum, excludeAux = null) {
        const connection = this.connections.get(connectionId);
        if (!connection) return { found: false, auxNum: null };
        return connection.isSourceOnAnyAux(sourceNum, excludeAux);
    }

    /**
     * Subscribe to ME bus source selection for a connection
     */
    subscribeToMEBus(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.subscribeToMEBus();
    }

    /**
     * Get current source on a specific ME bus
     */
    getMESource(connectionId, address) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getMESource(address);
    }

    getTimelineState(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getTimelineState();
    }

    subscribeToMasterTimeline(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return { success: false, message: `No connection found: ${connectionId}` };
        return connection.subscribeToMasterTimeline();
    }

    subscribeToImageStore(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return { success: false, message: `No connection found: ${connectionId}` };
        return connection.subscribeToImageStore();
    }

    getImageStoreImage(connectionId, output) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getImageStoreImage(output);
    }

    subscribeToTransitionTelemetry(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return { success: false, message: `No connection found: ${connectionId}` };
        return connection.subscribeToTransitionTelemetry();
    }

    getTransitionTelemetry(connectionId, did) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getTransitionTelemetry(did);
    }

    sendTimelineEvent(connectionId, eid, did, data) {
        const connection = this.connections.get(connectionId);
        if (!connection) return { success: false, message: `No connection found: ${connectionId}` };
        return connection.sendTimelineEvent(eid, did, data);
    }

    /**
     * Get all ME state for a connection
     */
    getAllMEState(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getAllMEState();
    }

    /**
     * Check if a source is on any ME bus (for low tally)
     */
    isSourceOnAnyME(connectionId, sourceNum, excludeAddress = null) {
        const connection = this.connections.get(connectionId);
        if (!connection) return { found: false, address: null };
        return connection.isSourceOnAnyME(sourceNum, excludeAddress);
    }

    /**
     * Subscribe to source names (0x0210 + 0x020b) for a connection
     */
    subscribeToSourceNames(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) {
            return { success: false, message: `No connection found: ${connectionId}` };
        }
        return connection.subscribeToSourceNames();
    }

    /**
     * Get source name entry for a specific source number
     */
    getSourceName(connectionId, sourceNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.getSourceName(sourceNum);
    }

    getSourceNames(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return [];
        return connection.getSourceNames();
    }

    /**
     * Resolve a source number to the best display name (menu > oled > panel > eng)
     * Returns null if no name found - caller should fall back to hardcoded labels
     */
    resolveSourceDisplayName(connectionId, sourceNum) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;
        return connection.resolveSourceDisplayName(sourceNum);
    }

    /**
     * Get all connections info
     */
    getAllConnectionsInfo() {
        const info = [];
        for (const [id, connection] of this.connections) {
            info.push(this.getConnectionInfo(id));
        }
        return info;
    }
}

// Create singleton instance
const connectionManager = new ConnectionManager();

// Export both the class and singleton
module.exports = {
    ConnectionManager,
    connectionManager,
    // Convenience exports
    initialize: (sdkSettings) => connectionManager.initialize(sdkSettings),
    createConnection: (id, host, suite, ports, suiteName, pluginVersion, buildDate) => connectionManager.createConnection(id, host, suite, ports, suiteName, pluginVersion, buildDate),
    disconnectConnection: (id) => connectionManager.disconnectConnection(id),
    getConnection: (id) => connectionManager.getConnection(id),
    isConnected: (id) => connectionManager.isConnected(id),
    sendMacro: (id, macroNum) => connectionManager.sendMacro(id, macroNum),
    sendMacroStop: (id, macroNum) => connectionManager.sendMacroStop(id, macroNum),
    sendMacroStopAll: (id) => connectionManager.sendMacroStopAll(id),
    sendAuxRoute: (id, auxNum, sourceNum, transitionType) => connectionManager.sendAuxRoute(id, auxNum, sourceNum, transitionType),
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
    getAllAuxState: (id) => connectionManager.getAllAuxState(id),
    isSourceOnAnyAux: (id, sourceNum, excludeAux) => connectionManager.isSourceOnAnyAux(id, sourceNum, excludeAux),
    subscribeToMEBus: (id) => connectionManager.subscribeToMEBus(id),
    getMESource: (id, address) => connectionManager.getMESource(id, address),
	 getTimelineState: (id) => connectionManager.getTimelineState(id),
	 subscribeToMasterTimeline: (id) => connectionManager.subscribeToMasterTimeline(id),
	 subscribeToImageStore: (id) => connectionManager.subscribeToImageStore(id),
	 getImageStoreImage: (id, output) => connectionManager.getImageStoreImage(id, output),
	 subscribeToTransitionTelemetry: (id) => connectionManager.subscribeToTransitionTelemetry(id),
	 getTransitionTelemetry: (id, did) => connectionManager.getTransitionTelemetry(id, did),
	 sendTimelineEvent: (id, eid, did, data) => connectionManager.sendTimelineEvent(id, eid, did, data),
    getAllMEState: (id) => connectionManager.getAllMEState(id),
    isSourceOnAnyME: (id, sourceNum, excludeAddress) => connectionManager.isSourceOnAnyME(id, sourceNum, excludeAddress),
    subscribeToSourceNames: (id) => connectionManager.subscribeToSourceNames(id),
    getSourceName: (id, sourceNum) => connectionManager.getSourceName(id, sourceNum),
    getSourceNames: (id) => connectionManager.getSourceNames(id),
    resolveSourceDisplayName: (id, sourceNum) => connectionManager.resolveSourceDisplayName(id, sourceNum),
    getConnectionInfo: (id) => connectionManager.getConnectionInfo(id),
    getAllConnectionsInfo: () => connectionManager.getAllConnectionsInfo(),
    getActiveConnections: () => connectionManager.getActiveConnections(),
    clientEmitter: connectionManager.emitter
};
