// @ts-nocheck
// Class-based handshake connection - supports multiple simultaneous connections
// Supports both TCP (V16+/V18) and UDP (V14) protocols with auto-detection
const dgram = require('dgram');
const net = require('net');
const EventEmitter = require('events');
const crypto = require('crypto');

// V18 TCP session framing constants
const SESSION_HEADER = Buffer.from([0xb9, 0x91, 0x6f, 0x84]);
const SESSION_TRAILER = Buffer.from([0x37, 0x62, 0xc5, 0xd9]);
const TCP_DETECT_TIMEOUT = 2000; // 2 seconds to detect V18+ frame

/**
 * HandshakeConnection - Manages a single connection to a GV suite
 * Each instance maintains its own sockets, state, and event emitter
 */
class HandshakeConnection {
    constructor(connectionId, targetHost, suite, customPorts, sdkGlobalSettings, suiteName, pluginVersion, buildDate) {
        this.connectionId = connectionId;
        this.targetHost = targetHost;
        this.suite = suite;
        this.customPorts = customPorts;
        this.sdkGlobalSettings = sdkGlobalSettings;
        this.suiteName = suiteName || 'Unknown';
        this.pluginVersion = pluginVersion || '0.0.0.0';
        this.buildDate = buildDate || 'Jan  1 1970';
        this.clientName = `Companion - ${this.suiteName}`;
        
        // Connection state
        this.mainClient = null;
        this.listenerClient = null;
        this.secondPhaseDynamicCommPort = 0;
        this.announcedTargetPort = 0;
        this.mainHandshakeStage = 1;
        this.isClosing = false;
        
        // Timers and intervals
        this.heartbeatIntervalId = null;
        this.packet1RetryIntervalId = null;
        this.heartbeatTimeoutId = null;
        this.handshakeOverallTimeoutId = null;
        
        // State tracking
        this.lastHeartbeatResponseTime = 0;
        this.missedHeartbeats = 0;
        this.initialHeartbeatSent = false;
        this.lastSentMacroId = null;
        this.macroQueue = [];
        this.isSendingMacro = false;
        this.fullyConnected = false; // Only true after CONNECTED event (2 sec stable heartbeat)
        
        // Message ID tracking
        this.recentlyUsedIds = [];
        this.nextMacroId = 0;
        this.lastPersistedMessageId = null;
        this.lastUsedSessionId = null;

        // AUX subscription state
        this.auxState = new Map();           // auxNum (1-96) -> currentSourceNum
        this.subscribedAuxes = new Set();    // Set of auxNum we've subscribed to
        this.auxSubscriptionIds = new Map(); // subscriptionId -> auxNum (not used yet, for future response tracking)
        this.nextSubscriptionId = 0x0400;    // Starting subscription ID range
        this.subscriptionSequence = 0x0300;  // Sequence counter for subscription packets
        this.subscriptionDataPort = 0;       // Port the frame uses to send subscription data to listener

        // ME bus subscription state
        this.meState = new Map();            // address byte -> currentSourceNum
        this.subscribedMEs = new Set();      // Tracking set (like subscribedAuxes)
        this.meSubscriptionIds = new Map();  // subscriptionId -> address byte

        // Source name state (0x020b + 0x0210 subscriptions)
        this.sourceNames = new Map();         // sourceId (number) -> { oled, short, eng, panel, menu }
        this.sourceNamesSubscribed = false;

        // TCP state (V16+/V18)
        this.protocol = 'udp'; // 'tcp' or 'udp' - set during start()
        this.tcpSocket = null;
        this.tcpBuffer = Buffer.alloc(0);
        this.lastTcpDataTime = 0;
        this.tcpHeartbeatCheckId = null;
        this.tcpActiveHeartbeatId = null;
        this.frameVersion = null; // e.g., "V18.0.0"
        this.frameName = null;    // e.g., "Frame Facility Interface"
        this.frameBuildDate = null;

        // Macro catalog state (TCP/V16+ only)
        this.macroCatalog = new Map();        // macroNumber (1-999) -> { oled, panel, comment }
        this.macroCatalogReady = false;       // True after bulk load complete
        this.macroCatalogBulkTimerId = null;  // Timer for detecting bulk load completion
        this.macroCatalogSubscribed = false;  // Whether we've sent the subscribe packet
        this.macroCatalogDataSeen = false;    // Set true after first valid macro data arrives
        this.macroCatalogRetryTimerId = null; // Retry timer for dropped initial subscribe
        this.macroCatalogSubscribeAttempts = 0;

        // Macro run-state (status subscription sub_id 0x0234)
        this.macroStatus = new Map();         // macroNumber (1-999) -> eMacroStatus (1=Playing, 7=Paused)
        this.lastPlayedMacro = null;          // macro number most recently played (not continued)
        this.runSeq = 0;                      // bumped on any macroStatus or lastPlayedMacro change
        this.macroStatusSubscribed = false;
        this.macroStatusDeferTimerId = null;   // V14: defer subscribe until catalog dump settles
        // (_optimisticPlayTimer / _optimisticPlayMacro removed — the frame is
        // the sole source of truth for Playing/Paused state; see afterMacroFire)

        // Event emitter for this connection
        this.emitter = new EventEmitter();
        
        // Configuration
        this.mainClientPort = customPorts?.mainPort || 6130;
        this.listenerClientPort = customPorts?.listenerPort || 6131;
        this.initialServerPort = 5000;
        this.portAnnounceServerPort = 5001;
        this.heartbeatIntervalMs = 1000;
        this.heartbeatTimeoutMs = this.heartbeatIntervalMs * 2.5;
        this.handshakeTimeoutMs = 10000;
        this.MAX_MISSED_HEARTBEATS = 5;
        this.MAX_TRACKED_IDS = 50;
        this.macroSendDelayMs = 50;
        this.MAX_MACRO_SUBSCRIBE_ATTEMPTS = 8;
        this.MACRO_SUBSCRIBE_RETRY_MS = 1500;

        // Payloads (same as original)
        this.setupPayloads();
        this.setupTemplates();
        this.setupSuiteCommands();
    }
    
    setupPayloads() {
        // Handshake 1 payloads
        this.payloadPacket1 = Buffer.from([0x00, 0x06, 0x00, 0x00]);
        this.expectedPayloadPacket2 = Buffer.from([0x00, 0x02, 0x00, 0x00]);
        this.payloadPacket3 = Buffer.from([0x00, 0x01, 0x00, 0x00]);
        this.expectedPayloadPacket4 = Buffer.from([0x00, 0x02, 0x00, 0x00]);
        const nameBytes = Buffer.from(`${this.clientName}\x00`, 'ascii');
        const authOuterLen = 4 + nameBytes.length; // seq(2) + clientId(2) + name
        const packet5Header = Buffer.alloc(20);
        packet5Header.writeUInt16BE(0x0004, 0);
        packet5Header.writeUInt16BE(0x0001, 2);
        packet5Header.writeUInt16BE(0x0002, 4);
        packet5Header.writeUInt16BE(0x001f, 6);
        packet5Header.writeUInt32BE(authOuterLen, 8);
        packet5Header.writeUInt32BE(0x0000002c, 12);
        packet5Header.writeUInt16BE(0x0001, 16);
        packet5Header.writeUInt16BE(0x0000, 18);
        this.payloadPacket5 = Buffer.concat([packet5Header, nameBytes]);
        this.expectedPayloadPacket6 = Buffer.from([0x00, 0x02, 0x00, 0x01]);

        // Listener Channel payloads
        this.expectedPayloadPacket7 = Buffer.from([0x00, 0x01, 0x00, 0x00]);
        this.payloadPacket8 = Buffer.from([0x00, 0x02, 0x00, 0x00]);
        this.expectedPayloadPacket10 = Buffer.from([0x00, 0x02, 0x00, 0x01]);

        // Handshake 2 payloads
        this.payloadPacket12 = Buffer.from([0x00, 0x06, 0x00, 0x00]);
        this.expectedPayloadPacket13 = Buffer.from([0x00, 0x02, 0x00, 0x00]);
        this.payloadPacket14 = Buffer.from([0x00, 0x01, 0x00, 0x00]);
        this.expectedPayloadPacket15 = Buffer.from([0x00, 0x02, 0x00, 0x00]);
        const packet16Base = Buffer.alloc(16);
        packet16Base.writeUInt16BE(0x0004, 0);
        packet16Base.writeUInt16BE(0x0001, 2);
        packet16Base.writeUInt16BE(0x0002, 4);
        packet16Base.writeUInt16BE(0x001f, 6);
        packet16Base.writeUInt32BE(authOuterLen, 8);
        packet16Base.writeUInt32BE(0x0000002c, 12);
        this.payloadPacket16Base = packet16Base;
        this.payloadPacket16Client = Buffer.from(`${this.clientName}\x00`, 'ascii');
        this.expectedPayloadPacket17 = Buffer.from([0x00, 0x02, 0x00, 0x01]);
        
        // Heartbeat payloads
        this.clientHeartbeatPayload = Buffer.from([0x00, 0x01, 0x00, 0x00]);
        this.expectedServerHeartbeatResponse = Buffer.from([0x00, 0x02, 0x00, 0x00]);
    }
    
    setupTemplates() {
        // All hex-string templates replaced by buildSetParam()/buildSetEvent() computed builders.
        // Kept as a hook for any future template additions.
    }
    
    setupSuiteCommands() {
        this.suiteCommands = {
            'suite1a': [
                Buffer.from('0004017c000200060000000c0000001417960200010000070000000a', 'hex'),
                Buffer.from('000407a700020005000000090000001004b600000100000700', 'hex')
            ],
            'suite2a': [
                Buffer.from('0004017a000200060000000c0000001417960200010000070000000c', 'hex'),
                Buffer.from('000407a700020005000000090000001004b600000100000700', 'hex')
            ],
            'suite3a': [
                Buffer.from('0004017e000200060000000c0000001417960200010000070000000e', 'hex'),
                Buffer.from('000407ab00020005000000090000001004b600000100000700', 'hex')
            ],
            'suite4a': [
                Buffer.from('000401f7000200060000000c00000014179602000100000700000010', 'hex'),
                Buffer.from('000407ab00020005000000090000001004b600000100000700', 'hex')
            ],
            'suite1b': [
                Buffer.from('0004017c000200060000000c0000001417960200010000070000000b', 'hex'),
                Buffer.from('000407a700020005000000090000001004b600000100000700', 'hex')
            ],
            'suite2b': [
                Buffer.from('0004017a000200060000000c0000001417960200010000070000000d', 'hex'),
                Buffer.from('000407a700020005000000090000001004b600000100000700', 'hex')
            ],
            'suite3b': [
                Buffer.from('0004017e000200060000000c0000001417960200010000070000000f', 'hex'),
                Buffer.from('000407ab00020005000000090000001004b600000100000700', 'hex')
            ],
            'suite4b': [
                Buffer.from('00040232000200060000000c00000014179602000100000700000011', 'hex'),
                Buffer.from('000407ab00020005000000090000001004b600000100000700', 'hex')
            ]
        };
    }
    
    // Aux state persistence
    async loadAuxState() {
        if (!this.sdkGlobalSettings) {
            this.emitter.emit('status', 'ERROR', 'Cannot load aux state: SDK settings not initialized.');
            this.lastPersistedMessageId = null;
            return;
        }
        try {
            const settings = await this.sdkGlobalSettings.getGlobalSettings();
            const stateKey = `com.gv.macro.player.auxState.${this.connectionId}`;
            const state = settings[stateKey];
            if (state && typeof state.last_message_id === 'number') {
                this.lastPersistedMessageId = state.last_message_id;
            } else {
                this.lastPersistedMessageId = null;
            }
        } catch (error) {
            this.emitter.emit('status', 'ERROR', `Error loading aux state: ${error.message}`);
            this.lastPersistedMessageId = null;
        }
        this.lastUsedSessionId = null;
    }
    
    async saveAuxState(idToSave) {
        if (!this.sdkGlobalSettings) return;
        try {
            const currentGlobalSettings = await this.sdkGlobalSettings.getGlobalSettings() || {};
            const stateKey = `com.gv.macro.player.auxState.${this.connectionId}`;
            const newAuxState = { last_message_id: idToSave };
            const newGlobalSettings = {
                ...currentGlobalSettings,
                [stateKey]: newAuxState
            };
            await this.sdkGlobalSettings.setGlobalSettings(newGlobalSettings);
        } catch (error) {
            this.emitter.emit('status', 'ERROR', `Error saving aux state: ${error.message}`);
        }
    }
    
    generateUniqueAuxId() {
        let attempts = 0;
        const maxAttempts = 100;
        let candidateId;
        
        do {
            candidateId = crypto.randomInt(0, 65536);
            attempts++;
            
            const isFirstGenThisSession = (this.lastUsedSessionId === null);
            const collisionWithPersisted = (isFirstGenThisSession && this.lastPersistedMessageId !== null && candidateId === this.lastPersistedMessageId);
            const collisionWithSession = (this.lastUsedSessionId !== null && candidateId === this.lastUsedSessionId);
            
            if (collisionWithPersisted || collisionWithSession) continue;
            break;
        } while (attempts < maxAttempts);
        
        this.lastUsedSessionId = candidateId;
        return candidateId;
    }
    
    // Start the connection process - auto-detects TCP (V16+) or UDP (V14)
    async start() {
        await this.loadAuxState();

        this.emitter.emit('status', 'CONNECTING', 'Detecting protocol...');

        // Try TCP first (V16+/V18 detection)
        try {
            const tcpConnected = await this.tryTcpConnect();
            if (tcpConnected) {
                this.protocol = 'tcp';
                const result = await this.startTcp();
                if (result !== false) {
                    return result;
                }
                // Auth failed — fall through to UDP
            }
        } catch (e) {
        }

        // Fall back to UDP (V14)
        this.protocol = 'udp';
        return await this.startUdp();
    }

    // Try TCP connect to port 5000 with timeout, binding to suite listener port
    tryTcpConnect() {
        return new Promise((resolve, reject) => {
            const sock = new net.Socket();
            let settled = false;

            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    sock.destroy();
                    reject(new Error('TCP connect timeout'));
                }
            }, TCP_DETECT_TIMEOUT);

            sock.on('error', (err) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    sock.destroy();
                    reject(err);
                }
            });

            // Connect without binding to a specific local port - the frame validates via
            // auth handshake, not source port. Using ephemeral ports avoids TIME_WAIT
            // conflicts when reconnecting after a disconnect.
            sock.connect({
                port: this.initialServerPort,
                host: this.targetHost
            }, () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    this.tcpSocket = sock;
                    resolve(true);
                }
            });
        });
    }

    // TCP session frame wrapping
    tcpWrap(payload) {
        const lenBuf = Buffer.alloc(2);
        lenBuf.writeUInt16BE(payload.length, 0);
        return Buffer.concat([SESSION_HEADER, lenBuf, payload, SESSION_TRAILER]);
    }

    // TCP session frame unwrapping - returns (frames[], remainingBuffer)
    tcpUnwrap(buffer) {
        const frames = [];
        while (true) {
            const idx = buffer.indexOf(SESSION_HEADER);
            if (idx === -1 || buffer.length < idx + 6) break;
            const length = buffer.readUInt16BE(idx + 4);
            const frameEnd = idx + 6 + length + 4;
            if (buffer.length < frameEnd) break;
            const trailer = buffer.slice(frameEnd - 4, frameEnd);
            if (!trailer.equals(SESSION_TRAILER)) {
                buffer = buffer.slice(idx + 4);
                continue;
            }
            frames.push(buffer.slice(idx + 6, frameEnd - 4));
            buffer = buffer.slice(frameEnd);
        }
        return { frames, remaining: buffer };
    }

    // TCP authentication packet
    tcpAuthPacket(seq, clientId = 0) {
        const nameBytes = Buffer.from(`${this.clientName}\x00`, 'ascii');
        const payload = Buffer.alloc(16 + nameBytes.length);
        let off = 0;
        payload.writeUInt16BE(0x0002, off); off += 2;  // prefix
        payload.writeUInt16BE(0x001f, off); off += 2;  // cmd
        payload.writeUInt32BE(4 + nameBytes.length, off); off += 4; // outer_len = seq(2)+clientId(2)+name
        payload.writeUInt32BE(0x0000002c, off); off += 4;
        payload.writeUInt16BE(seq, off); off += 2;
        payload.writeUInt16BE(clientId, off); off += 2;
        nameBytes.copy(payload, off);
        return this.tcpWrap(payload);
    }

    // CPL SetParam — sendToFrame()-compatible (UDP DATA header + CPL body).
    // sendToFrame() strips the 4-byte header for TCP and tcpWraps; sends as-is for UDP.
    // outer_len = 8 + data.length,  inner_len = outer_len + 8,  type_flags: 0x0800=string 0x0300=uint16
    buildSetParam(pid, typeFlags, did, data) {
        const outerLen = 8 + data.length;
        const innerLen = outerLen + 8;
        const frame = Buffer.alloc(24 + data.length);
        let off = 0;
        frame.writeUInt16BE(0x0004, off); off += 2; // UDP DATA type
        frame.writeUInt16BE(this.generateUniqueAuxId(), off); off += 2; // unique msg_id
        frame.writeUInt16BE(0x0002, off); off += 2; // CPL prefix
        frame.writeUInt16BE(0x0006, off); off += 2; // cmd SET (0x0006)
        frame.writeUInt32BE(outerLen, off); off += 4;
        frame.writeUInt32BE(innerLen, off); off += 4;
        frame.writeUInt16BE(pid, off); off += 2;
        frame.writeUInt16BE(typeFlags, off); off += 2;
        frame.writeUInt32BE(did, off); off += 4;
        data.copy(frame, off);
        return frame;
    }
    buildSetFrame(pid, typeFlags, did, data) { return this.buildSetParam(pid, typeFlags, did, data); }

    // CPL SetEvent — sendToFrame()-compatible. outer = 8 + data.length, inner = outer + 7.
    // msgId override exists for the macro path: createMacroPayload() MUST keep the 0x03xx
    // message-ID page or the 4-byte UDP MACRO_ACK match (0002 03 id) breaks.
    buildSetEvent(eid, did, data = Buffer.alloc(0), msgId = null) {
        const outerLen = 8 + data.length;
        const frame = Buffer.alloc(24 + data.length);
        let off = 0;
        frame.writeUInt16BE(0x0004, off); off += 2;
        frame.writeUInt16BE(msgId !== null ? msgId : this.generateUniqueAuxId(), off); off += 2;
        frame.writeUInt16BE(0x0002, off); off += 2;
        frame.writeUInt16BE(0x0005, off); off += 2;       // cmd SetEvent
        frame.writeUInt32BE(outerLen, off); off += 4;
        frame.writeUInt32BE(outerLen + 7, off); off += 4; // inner = outer + 7
        frame.writeUInt16BE(eid, off); off += 2;
        frame.writeUInt16BE(0x0000, off); off += 2;
        frame.writeUInt32BE(did, off); off += 4;
        data.copy(frame, off);
        return frame;
    }

    // Announce plugin identity to Engineering > Panel Connections GUI after CONNECTED.
    // Works on both TCP (V16+/V18) and UDP (V14) via sendToFrame().
    announceIdentity() {
        if (this.isClosing) return;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const versionStr = `V${this.pluginVersion}`;

        // Node Type = 8 (blank/unlabelled), PID 0x2008, DID 0x01000001, uint16
        this.sendToFrame(this.buildSetFrame(0x2008, 0x0300, 0x01000001, Buffer.from([0x00, 0x08])));
        // Version string, PID 0x134F, DID 0x2F003001
        this.sendToFrame(this.buildSetFrame(0x134F, 0x0800, 0x2F003001, Buffer.from(`${versionStr}\x00`, 'ascii')));
        // Time stamp, PID 0x1350, DID 0x2F003001
        this.sendToFrame(this.buildSetFrame(0x1350, 0x0800, 0x2F003001, Buffer.from(`${timeStr}\x00`, 'ascii')));
        // Date stamp, PID 0x1351, DID 0x2F003001
        this.sendToFrame(this.buildSetFrame(0x1351, 0x0800, 0x2F003001, Buffer.from(`${this.buildDate}\x00`, 'ascii')));

    }

    // TCP subscribe command (cmd 0x0008)
    tcpSubscribe(subId, flags, sigAndParams) {
        const payload = Buffer.alloc(48);
        let off = 0;
        payload.writeUInt16BE(0x0002, off); off += 2;     // prefix
        payload.writeUInt16BE(0x0008, off); off += 2;     // cmd SUBSCRIBE
        payload.writeUInt32BE(0x00000024, off); off += 4; // outer length
        payload.writeUInt32BE(0x0000002e, off); off += 4; // inner length
        off += 16; // 16 zero bytes padding
        payload.writeUInt16BE(subId, off); off += 2;
        flags.copy(payload, off); off += flags.length;
        sigAndParams.copy(payload, off);
        return this.tcpWrap(payload);
    }

    // Parse frame version, name, build date from raw data
    parseFrameInfo(data) {
        const ascii = Array.from(data).map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : ' ').join('');

        let version = null;
        let name = null;
        let buildDate = null;

        const vMatch = ascii.match(/V\d+\.\d+(?:\.\d+)?/);
        if (vMatch) version = vMatch[0];

        if (ascii.includes('Frame Facility Interface')) {
            name = 'Frame Facility Interface';
        } else {
            for (const ft of ['Kayenne', 'Karrera', 'GV Korona', 'K-Frame']) {
                if (ascii.includes(ft)) { name = ft; break; }
            }
        }

        const dMatch = ascii.match(/[A-Z][a-z]{2} +\d{1,2} \d{4}/);
        if (dMatch) buildDate = dMatch[0];

        return { version, name, buildDate };
    }

    // Start TCP path (V16+/V18). Returns cleanup closure on success, false on auth failure.
    async startTcp() {
        this.emitter.emit('status', 'CONNECTING', 'TCP Authentication...');

        // K-Frame Menu waits ~1s after TCP connect before AUTH1 (capture-confirmed;
        // immediate AUTH races frame CPL-buffer registration on busy frames).
        await this.sleep(1000);

        // Auth packet 1 (seq=1)
        this.tcpSocket.write(this.tcpAuthPacket(0x0001));

        // Wait for a complete framed AUTH response (3s matches engine.py:1184-1185)
        const authOk = await this.tcpWaitForFrame(3000);

        if (!authOk) {
            this.abortTcpAttempt('No framed AUTH response within 3s');
            return false;
        }

        // Parse assigned client ID (informational, not used in AUTH3)
        if (this.tcpAuthPayload && this.tcpAuthPayload.length >= 16) {
            const assignedId = this.tcpAuthPayload.readUInt16BE(14);
        }
        this.tcpAuthPayload = null;

        // Install permanent error/close handlers AFTER auth succeeds
        this.tcpSocket.on('error', (err) => {
            this.emitter.emit('status', 'ERROR', `TCP error: ${err.message}`);
            this.cleanup();
        });
        this.tcpSocket.on('close', () => {
            if (!this.isClosing) {
                this.emitter.emit('status', 'DISCONNECTED', 'TCP connection closed by frame');
                this.cleanup();
            }
        });

        await this.sleep(500);

        // Auth packet 3 (seq=3, client ID 0 — not the assigned ID)
        this.tcpSocket.write(this.tcpAuthPacket(0x0003));
        await this.sleep(500);

        // Drain auth3 response
        this.tcpBuffer = Buffer.alloc(0);

        this.emitter.emit('status', 'CONNECTING', 'TCP Registration...');

        // Registration 1: 0x11e5
        this.tcpSocket.write(this.tcpSubscribe(
            0x0005,
            Buffer.from([0x00,0x00,0x00,0x03,0x00,0x01,0x00,0x02,0x00,0x00]),
            Buffer.from([0x11,0xe5,0x00,0x00,0x22,0x00,0x00,0x00])
        ));
        await this.sleep(100);

        // Registration 2: 0x11a1
        this.tcpSocket.write(this.tcpSubscribe(
            0x0002,
            Buffer.from([0x00,0x01,0x00,0x03,0x00,0x03,0x00,0x00,0x00,0x00]),
            Buffer.from([0x11,0xa1,0x00,0x00,0x62,0x00,0x00,0x00])
        ));
        await this.sleep(100);

        // Registration 3: 0x11a5
        this.tcpSocket.write(this.tcpSubscribe(
            0x0002,
            Buffer.from([0x00,0x00,0x00,0x03,0x00,0x01,0x00,0x00,0x00,0x00]),
            Buffer.from([0x11,0xa5,0x00,0x00,0x62,0x00,0x00,0x00])
        ));
        await this.sleep(100);

        // Registration 4: 0x11e5 re-reg
        this.tcpSocket.write(this.tcpSubscribe(
            0x0005,
            Buffer.from([0x00,0x01,0x00,0x03,0x00,0x03,0x00,0x00,0x00,0x00]),
            Buffer.from([0x11,0xe5,0x00,0x00,0x22,0x00,0x00,0x00])
        ));
        await this.sleep(100);

        // Frame info subscriptions (sub_id 0x01fe, matching native GUI Wireshark capture)
        // First subscription: data[0]=0x01, sig[7]=0x0f
        this.tcpSocket.write(this.tcpSubscribe(
            0x01fe,
            Buffer.from([0x00,0x01,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]),
            Buffer.from([0x00,0x08,0x00,0x01,0x01,0x00,0x00,0x0f])
        ));
        await this.sleep(100);
        // Second subscription: data[0]=0x02, sig[7]=0x01
        this.tcpSocket.write(this.tcpSubscribe(
            0x01fe,
            Buffer.from([0x00,0x02,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]),
            Buffer.from([0x00,0x08,0x00,0x01,0x01,0x00,0x00,0x01])
        ));

        // NOW attach the permanent data handler (after auth is complete, no double-buffering)
        this.tcpBuffer = Buffer.alloc(0);
        this.tcpSocket.on('data', (data) => this.handleTcpData(data));
        this.lastTcpDataTime = Date.now();
        this.mainHandshakeStage = 9; // Mark as connected (stage 9 = operational)
        this.secondPhaseDynamicCommPort = this.initialServerPort; // Show frame port (5000) on button

        // Active TCP heartbeat: re-send frame info subscription every 8s
        // This keeps the connection alive and refreshes frame version data
        this.tcpActiveHeartbeatId = setInterval(() => {
            if (this.isClosing || !this.tcpSocket) {
                clearInterval(this.tcpActiveHeartbeatId);
                return;
            }
            try {
                this.tcpSocket.write(this.tcpSubscribe(
                    0x01fe,
                    Buffer.from([0x00,0x02,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]),
                    Buffer.from([0x00,0x08,0x00,0x01,0x01,0x00,0x00,0x01])
                ));
            } catch (e) {
                // Write failed - connection is dead
            }
        }, 8000);

        // Passive TCP heartbeat monitoring: disconnect if no data for 30 seconds
        this.tcpHeartbeatCheckId = setInterval(() => {
            if (this.isClosing) {
                clearInterval(this.tcpHeartbeatCheckId);
                return;
            }
            const elapsed = Date.now() - this.lastTcpDataTime;
            if (elapsed > 30000) {
                this.emitter.emit('status', 'HEARTBEAT_TIMEOUT', 'TCP connection lost (no data for 30s)');
                this.cleanup();
            }
        }, 5000);

        // Emit HANDSHAKE_COMPLETE, then wait for frame version before CONNECTED
        this.emitter.emit('status', 'HANDSHAKE_COMPLETE', 'TCP handshake complete, waiting for frame info...');

        // Wait a bit for frame info to arrive, then emit CONNECTED
        setTimeout(() => {
            if (this.mainHandshakeStage === 9 && !this.isClosing && !this.fullyConnected) {
                this.fullyConnected = true;
                this.emitter.emit('status', 'CONNECTED', 'TCP connection established.');

                // Announce plugin identity to Engineering > Panel Connections
                this.announceIdentity();

                // Select suite after connected, then subscribe to macro catalog + status
                if (this.suite && this.suiteCommands[this.suite]) {
                    this.tcpSelectSuite();
                    // Subscribe to macro catalog 500ms after suite selection,
                    // then macro status immediately after (TCP needs no deferral)
                    setTimeout(() => {
                        if (!this.isClosing) {
                            this.subscribeMacroCatalog();
                            this.subscribeMacroStatus();
                        }
                    }, 500);
                }
            }
        }, 2000);

        return () => this.cleanup();
    }

    // Handle incoming TCP data
    handleTcpData(data) {
        this.lastTcpDataTime = Date.now();
        this.tcpBuffer = Buffer.concat([this.tcpBuffer, data]);

        const { frames, remaining } = this.tcpUnwrap(this.tcpBuffer);
        this.tcpBuffer = remaining;

        for (const payload of frames) {
            // Try to parse frame info
            if (!this.frameVersion) {
                const info = this.parseFrameInfo(payload);
                if (info.version) {
                    this.frameVersion = info.version;
                    this.frameName = info.name;
                    this.frameBuildDate = info.buildDate;
                    this.emitter.emit('status', 'FRAME_VERSION', {
                        version: info.version,
                        name: info.name,
                        buildDate: info.buildDate
                    });
                }
            }

            // Only emit HEARTBEAT_ACK for frame info responses (our TCP heartbeat mechanism)
            // The active heartbeat re-subscribes to 0x01fe every 8s; the frame echoes sub_id 0x01fe
            // at payload offset 12 (after sub_cmd[2] + resp_type[2] + pay_len[4] + sec_len[4])
            // This prevents subscription data and command responses from triggering the connect button dot flash
            const isFrameInfoResponse = payload.length >= 14 && payload.readUInt16BE(12) === 0x01fe;
            if (this.fullyConnected && isFrameInfoResponse) {
                this.emitter.emit('status', 'HEARTBEAT_ACK', 'TCP heartbeat response');
            }

            // Handle subscription data (AUX/ME bus updates)
            if (payload.length > 4) {
                // Wrap in a fake UDP-like format so handleSubscriptionData can parse it
                // handleSubscriptionData expects: [cmd_type:2][seq:2][data...]
                // For TCP, we just prepend a dummy 4-byte header
                const fakeMsg = Buffer.concat([Buffer.from([0x00, 0x04, 0x00, 0x00]), payload]);
                this.handleSubscriptionData(fakeMsg);
            }
        }
    }

    // Wait for TCP data to arrive (used during auth — legacy, kept for reference)
    tcpWaitForData(timeoutMs) {
        return new Promise((resolve) => {
            const handler = (data) => {
                this.tcpBuffer = Buffer.concat([this.tcpBuffer, data]);
                clearTimeout(timer);
                this.tcpSocket.removeListener('data', handler);
                resolve();
            };
            const timer = setTimeout(() => {
                this.tcpSocket.removeListener('data', handler);
                resolve();
            }, timeoutMs);
            this.tcpSocket.on('data', handler);
        });
    }

    tcpWaitForFrame(timeoutMs) {
        return new Promise((resolve) => {
            let settled = false;
            let timer = null;
            let onData = null;
            let onFail = null;

            const settle = (val) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (this.tcpSocket) {
                    if (onData) this.tcpSocket.removeListener('data', onData);
                    if (onFail) {
                        this.tcpSocket.removeListener('error', onFail);
                        this.tcpSocket.removeListener('close', onFail);
                    }
                }
                resolve(val);
            };

            const tryExtract = () => {
                const { frames, remaining } = this.tcpUnwrap(this.tcpBuffer);
                if (frames.length > 0) {
                    this.tcpAuthPayload = frames[0];
                    this.tcpBuffer = remaining;
                    settle(true);
                }
            };

            // Check bytes already in buffer
            tryExtract();
            if (settled) return;

            onData = (chunk) => {
                this.tcpBuffer = Buffer.concat([this.tcpBuffer, chunk]);
                tryExtract();
            };
            onFail = () => settle(false);
            timer = setTimeout(() => settle(false), timeoutMs);

            this.tcpSocket.on('data', onData);
            this.tcpSocket.on('error', onFail);
            this.tcpSocket.on('close', onFail);
        });
    }

    abortTcpAttempt(reason) {
        this.emitter.emit('status', 'TCP_AUTH_FAILED', reason);
        if (this.tcpSocket) {
            this.tcpSocket.removeAllListeners();
            this.tcpSocket.destroy();
            this.tcpSocket = null;
        }
        this.tcpBuffer = Buffer.alloc(0);
        this.tcpAuthPayload = null;
        this.isClosing = false;
        this.mainHandshakeStage = 1;
        this.fullyConnected = false;
    }

    // TCP suite selection
    tcpSelectSuite() {
        if (!this.suite || !this.suiteCommands[this.suite]) return;

        // Get the RDP payloads from the existing suite commands (strip 4-byte UDP header)
        const cmds = this.suiteCommands[this.suite];
        const rdp1 = cmds[0].slice(4);
        this.tcpSocket.write(this.tcpWrap(rdp1));

        if (cmds.length > 1) {
            setTimeout(() => {
                if (!this.isClosing && this.tcpSocket) {
                    const rdp2 = cmds[1].slice(4);
                    this.tcpSocket.write(this.tcpWrap(rdp2));
                }
            }, 100);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Subscribe to macro catalog (works on both TCP/V16+ and UDP/V14)
    subscribeMacroCatalog() {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        if (!this.macroCatalogSubscribed) {
            this.macroCatalog.clear();
            this.macroCatalogReady = false;
            this.macroCatalogDataSeen = false;
            this.macroCatalogSubscribeAttempts = 0;
            this.macroCatalogSubscribed = true;
        }

        if (this.protocol === 'tcp') {
            if (!this.tcpSocket) {
                return { success: false, message: 'TCP socket not available.' };
            }
            this.sendMacroCatalogSubscribeTcp();
        } else {
            this.sendMacroCatalogSubscribeUdp();
        }

        this.startMacroCatalogRetryLoop();
        return { success: true, message: `Macro catalog subscription sent (${this.protocol}).` };
    }

    sendMacroCatalogSubscribeTcp() {
        if (!this.tcpSocket || this.isClosing) return;

        this.tcpSocket.write(this.tcpSubscribe(
            0x0208,
            Buffer.from([0x00,0x01,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]),
            Buffer.from([0x00,0x23,0x00,0x01,0x77,0x00,0x00,0x00])
        ));

        this.macroCatalogSubscribeAttempts += 1;
    }

    /**
     * Send macro catalog subscription over UDP (V14).
     * Uses sub_id 0x020f with signature 0x0023 and params matching the V14 protocol.
     */
    sendMacroCatalogSubscribeUdp() {
        if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) return;

        const seqNum = this.subscriptionSequence++;
        const packet = Buffer.alloc(52);
        let off = 0;

        // Bytes 0-3: DATA header
        packet.writeUInt16BE(0x0004, off); off += 2;      // Packet type (DATA)
        packet.writeUInt16BE(seqNum, off); off += 2;      // Sequence number
        // Bytes 4-15: Subscribe command header
        packet.writeUInt16BE(0x0002, off); off += 2;      // Sub-command
        packet.writeUInt16BE(0x0008, off); off += 2;      // Command (SUBSCRIBE)
        packet.writeUInt32BE(0x00000024, off); off += 4;  // Payload length (36)
        packet.writeUInt32BE(0x0000002e, off); off += 4;  // Secondary length (46)
        // Bytes 16-31: Padding (zeros, already zero from alloc)
        off += 16;
        // Bytes 32-51: Macro catalog subscription parameters
        packet.writeUInt16BE(0x020f, off); off += 2;      // sub_id for V14 macro catalog
        Buffer.from([0x00,0x01,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]).copy(packet, off); off += 10;
        Buffer.from([0x00,0x23,0x00,0x01,0x77,0x00,0x00,0x00]).copy(packet, off);

        this.mainClient.send(packet, this.secondPhaseDynamicCommPort, this.targetHost);
        this.macroCatalogSubscribeAttempts += 1;
    }

    /**
     * Send prerequisite registration subscribes over UDP (V14).
     * The frame requires these subscribes to be in place before it will send
     * macro catalog bulk data on the listener socket.
     * Discovered via Wireshark capture of working client (rows 59-83).
     */
    sendUdpRegistrationSubscribes(callback) {
        if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) {
            if (callback) callback();
            return;
        }

        // Helper: send a raw hex payload wrapped in a DATA header
        const sendRawSub = (hexPayload) => {
            const payload = Buffer.from(hexPayload, 'hex');
            const seqNum = this.subscriptionSequence++;
            const header = Buffer.alloc(4);
            header.writeUInt16BE(0x0004, 0);
            header.writeUInt16BE(seqNum, 2);
            const packet = Buffer.concat([header, payload]);
            this.mainClient.send(packet, this.secondPhaseDynamicCommPort, this.targetHost);
        };

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
        ];
        // ME crosspoint subscribes (0x4433-0x443b) — needed for Crosspoint Magic action
        // Fixed: original packets were 47 bytes (14-byte padding instead of 16), causing
        // ulOffset >= ulSize parser errors. Now 48 bytes with correct 16-byte zero padding.
        for (let meSub = 0x4433; meSub <= 0x443b; meSub++) {
            const hex = meSub.toString(16).padStart(4, '0');
            queue.push(`00020008000000240000002e00000000000000000000000000000000${hex}0001000300030000000019eb000077000000`);
        }

        // Send one packet every 50ms to avoid CPLScheduler buffer overflow
        let idx = 0;
        const sendNext = () => {
            if (this.isClosing || idx >= queue.length) {
                if (callback) callback();
                return;
            }
            sendRawSub(queue[idx]);
            idx++;
            setTimeout(sendNext, 50);
        };
        sendNext();
    }

    startMacroCatalogRetryLoop() {
        this.stopMacroCatalogRetryLoop();
        this.macroCatalogRetryTimerId = setInterval(() => {
            if (this.isClosing || !this.macroCatalogSubscribed || this.macroCatalogDataSeen) {
                this.stopMacroCatalogRetryLoop();
                return;
            }

            if (this.macroCatalogSubscribeAttempts >= this.MAX_MACRO_SUBSCRIBE_ATTEMPTS) {
                this.stopMacroCatalogRetryLoop();
                this.emitter.emit('status', 'MACRO_CATALOG_TIMEOUT', {
                    attempts: this.macroCatalogSubscribeAttempts
                });
                return;
            }

            if (this.protocol === 'tcp') {
                this.sendMacroCatalogSubscribeTcp();
            } else {
                this.sendMacroCatalogSubscribeUdp();
            }
        }, this.MACRO_SUBSCRIBE_RETRY_MS);
    }

    stopMacroCatalogRetryLoop() {
        if (this.macroCatalogRetryTimerId) {
            clearInterval(this.macroCatalogRetryTimerId);
            this.macroCatalogRetryTimerId = null;
        }
    }

    // --- Macro status subscription (sub_id 0x0234, sig 0x2F, list-0, DID 0x77000000) ---

    subscribeMacroStatus() {
        if (this.isClosing || this.mainHandshakeStage !== 9) return;
        if (this.macroStatusSubscribed) return;

        this.macroStatus.clear();
        this.lastPlayedMacro = null;
        this.runSeq++;
        this.macroStatusSubscribed = true;

        if (this.protocol === 'tcp') {
            this.sendMacroStatusSubscribeTcp();
        } else {
            this.sendMacroStatusSubscribeUdp();
        }
        this.emitter.emit('status', 'MACRO_STATUS_SUBSCRIBED', `${this.protocol} sub_id 0x0234`);
    }

    sendMacroStatusSubscribeTcp() {
        if (!this.tcpSocket || this.isClosing) return;
        this.tcpSocket.write(this.tcpSubscribe(
            0x0234,
            Buffer.from([0x00,0x01,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]),
            Buffer.from([0x00,0x2f,0x00,0x00,0x77,0x00,0x00,0x00])
        ));
    }

    sendMacroStatusSubscribeUdp() {
        if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) return;
        const seqNum = this.subscriptionSequence++;
        const packet = Buffer.alloc(52);
        let off = 0;
        packet.writeUInt16BE(0x0004, off); off += 2;
        packet.writeUInt16BE(seqNum, off); off += 2;
        packet.writeUInt16BE(0x0002, off); off += 2;
        packet.writeUInt16BE(0x0008, off); off += 2;
        packet.writeUInt32BE(0x00000024, off); off += 4;
        packet.writeUInt32BE(0x0000002e, off); off += 4;
        off += 16; // padding
        packet.writeUInt16BE(0x0234, off); off += 2;
        Buffer.from([0x00,0x01,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]).copy(packet, off); off += 10;
        Buffer.from([0x00,0x2f,0x00,0x00,0x77,0x00,0x00,0x00]).copy(packet, off);
        this.mainClient.send(packet, this.secondPhaseDynamicCommPort, this.targetHost);
    }

    // eMacroStatus constants (V18.0.2 SharedEnums.eMacroStatus):
    //   0=Stop 1=Play 2=Record 3=Load 4=Save 5=StopSave 6=StopPlay 7=Pause 8=Append
    static MS_ALL = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    static MS_ACTIVE = new Set([1, 7]);
    static STATUS_RANK = { 7: 3, 1: 2, 6: 2, 3: 1, 2: 1 };

    // OID linked-list form (V18.0.2): walk block headers, structured — can't false-match.
    statusEntriesOid(msg, pb, payLen) {
        const out = [];
        const n = pb + payLen;
        let pos = pb + 16; // skip 16-byte sub-header
        while (pos + 12 <= n) {
            const dataLen = msg.readUInt16BE(pos + 10);
            const ds = pos + 12;
            if (ds + dataLen > n) break;
            if (dataLen >= 6) {
                const index = msg.readUInt16BE(ds);
                const macroNum = msg.readUInt16BE(ds + 2) + 1;
                const nul = msg.indexOf(0x00, ds + 4);
                if (nul !== -1 && nul >= ds + 4 && nul + 3 <= ds + dataLen) {
                    const status = msg.readUInt16BE(nul + 1);
                    if (macroNum >= 1 && macroNum <= 999 && HandshakeConnection.MS_ALL.has(status)) {
                        out.push({ index, macroNum, status });
                    }
                }
            }
            pos = ds + dataLen;
        }
        return out;
    }

    // Legacy marker form: scan for 00 [01|02] 00 0e pattern. Fallback when OID yields nothing.
    statusEntriesMarker(msg, pb, payLen) {
        const out = [];
        const end = pb + payLen;
        for (let j = pb; j + 15 <= end; j++) {
            if (msg[j] === 0x00 && (msg[j + 1] === 0x01 || msg[j + 1] === 0x02) &&
                msg[j + 2] === 0x00 && msg[j + 3] === 0x0e) {
                const index = msg.readUInt16BE(j + 4);
                const macroNum = msg.readUInt16BE(j + 6) + 1;
                const status = msg.readUInt16BE(j + 13);
                if (macroNum >= 1 && macroNum <= 999 && HandshakeConnection.MS_ALL.has(status)) {
                    out.push({ index, macroNum, status });
                }
            }
        }
        return out;
    }

    // Shared post-processing: priority merge, active-state update, play detection.
    applyStatusEntries(entries) {
        const seen = new Map();
        for (const { index, macroNum, status } of entries) {
            const prev = seen.get(macroNum);
            if (prev === undefined ||
                (HandshakeConnection.STATUS_RANK[status] || 0) > (HandshakeConnection.STATUS_RANK[prev] || 0)) {
                seen.set(macroNum, status);
            }
        }

        const before = new Map(this.macroStatus);
        for (const [num, status] of seen) {
            if (HandshakeConnection.MS_ACTIVE.has(status)) {
                this.macroStatus.set(num, status);
            } else {
                this.macroStatus.delete(num);
            }
        }

        // Play detection (engine.py 646-671): IndexID 0 = ring head = last-played macro.
        // A push carrying IndexID 0 is a play IF the macro was NOT already running
        // (fresh start / instant-macro reporting Stopped) OR Playing->Playing (retrigger).
        const prevLastPlayed = this.lastPlayedMacro;
        const head = entries.find(e => e.index === 0);
        if (head) {
            const was = before.get(head.macroNum);
            if (was === undefined || (head.status === 1 && was === 1)) {
                this.lastPlayedMacro = head.macroNum;
            }
        }

        const changed = !this.mapsEqual(before, this.macroStatus) ||
                         this.lastPlayedMacro !== prevLastPlayed;
        if (changed) {
            this.runSeq++;
            this.emitter.emit('status', 'MACRO_STATUS_CHANGED', {
                macroStatus: Object.fromEntries(this.macroStatus),
                lastPlayedMacro: this.lastPlayedMacro,
                runSeq: this.runSeq
            });
        }
    }

    mapsEqual(a, b) {
        if (a.size !== b.size) return false;
        for (const [k, v] of a) { if (b.get(k) !== v) return false; }
        return true;
    }

    // Main entry point: OID first (structured, can't false-match), marker fallback.
    parseMacroStatusData(msg, pb, payLen) {
        let entries = this.statusEntriesOid(msg, pb, payLen);
        if (!entries.length) entries = this.statusEntriesMarker(msg, pb, payLen);
        if (!entries.length) return;
        this.applyStatusEntries(entries);
    }

    getMacroRunState() {
        return {
            macroStatus: Object.fromEntries(this.macroStatus),
            lastPlayedMacro: this.lastPlayedMacro,
            runSeq: this.runSeq
        };
    }

    getMacroStatusForMacro(macroNum) {
        return this.macroStatus.get(macroNum) || null;
    }

    /**
     * Subscribe to source names from the frame (0x0210 engineering names + 0x020b operator names).
     * Source names are subscribed FIRST so they're cached before AUX/ME data arrives.
     * Works on both TCP and UDP via sendToFrame().
     */
    subscribeToSourceNames() {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        if (this.sourceNamesSubscribed) {
            return { success: true, message: 'Already subscribed to source names.' };
        }

        // Build a 52-byte source name subscription packet.
        // Source name subs put the signature at bytes 32-33 (not a sub_id).
        const buildSourceNamePacket = (sig, flags6, params8) => {
            const seqNum = this.subscriptionSequence++;
            const packet = Buffer.alloc(52);
            let off = 0;

            // Bytes 0-31: Standard subscription header
            packet.writeUInt16BE(0x0004, off); off += 2;      // 0-1:   Packet type (DATA)
            packet.writeUInt16BE(seqNum, off); off += 2;      // 2-3:   Sequence number
            packet.writeUInt16BE(0x0002, off); off += 2;      // 4-5:   Sub-command
            packet.writeUInt16BE(0x0008, off); off += 2;      // 6-7:   Command (SUBSCRIBE)
            packet.writeUInt32BE(0x00000024, off); off += 4;  // 8-11:  Payload length (36)
            packet.writeUInt32BE(0x0000002e, off); off += 4;  // 12-15: Secondary length (46)
            off += 16;                                         // 16-31: Padding (zeros)

            // Bytes 32-51: Source name subscription parameters
            packet.writeUInt16BE(sig, off); off += 2;         // 32-33: Signature (0x0210 or 0x020b)
            Buffer.from(flags6).copy(packet, off); off += 6;  // 34-39: Flags
            packet.writeUInt32BE(0x00000000, off); off += 4;  // 40-43: Reserved (zeros)
            Buffer.from(params8).copy(packet, off);           // 44-51: Params

            return packet;
        };

        // 1. Source definitions (0x0210) - engineering names
        const srcDefPacket = buildSourceNamePacket(
            0x0210,
            [0x00,0x01,0x00,0x04,0x00,0x02],             // flags
            [0x00,0x10,0x00,0x01,0x62,0x00,0x00,0x00]    // params
        );
        this.sendToFrame(srcDefPacket);

        // Wait 100ms then send 0x020b (operator-customized names)
        setTimeout(() => {
            if (this.isClosing) return;
            const srcNamePacket = buildSourceNamePacket(
                0x020b,
                [0x00,0x01,0x00,0x04,0x00,0x03],             // flags
                [0x00,0x0c,0x00,0x01,0x64,0x1b,0x00,0x00]    // params
            );
            this.sendToFrame(srcNamePacket);
        }, 100);

        this.sourceNamesSubscribed = true;
        return { success: true, message: 'Source name subscriptions sent.' };
    }

    // Parse macro catalog data from a TCP payload
    parseMacroCatalogData(payload) {
        // OID range for macro slots: base = 0x1A8E. The slot OID's high 2 bytes are always
        // 0x0000, so the real ceiling is 0xFFFF; the old stride-1 assumption (0x1E75)
        // truncated V17/V18 catalogs mid-dump. macroNum 1..999 + dataLen guards already
        // protect against false matches.
        const MACRO_BASE_ADDR = 0x1A8E;
        const MACRO_MAX_ADDR = 0xFFFF;
        const subBytes = Buffer.from([0x02, 0x08]);
        const sigBytes = Buffer.from([0x00, 0x23]);
        let found = 0;

        // Require both macro sub_id and macro signature in the payload.
        const subIdx = payload.indexOf(subBytes);
        if (subIdx === -1) return 0;
        const sigIdx = payload.indexOf(sigBytes, subIdx);
        if (sigIdx === -1) return 0;

        // Skip signature(2) + params(6) to reach entry area.
        let pos = sigIdx + 8;
        while (pos < payload.length - 12) {
            // Look for 4-byte address pattern: 00 00 XX XX where XX XX is in macro OID range
            if (payload[pos] === 0x00 && payload[pos + 1] === 0x00) {
                const addr = payload.readUInt16BE(pos + 2);
                if (addr >= MACRO_BASE_ADDR && addr <= MACRO_MAX_ADDR) {
                    const hdr = pos + 4; // Skip this_addr (4 bytes)

                    // Need at least next_addr(4) + field_count(2) + data_len(2) = 8 bytes
                    if (hdr + 8 > payload.length) break;

                    const dataLen = payload.readUInt16BE(hdr + 6);
                    const dataStart = hdr + 8;

                    // Ignore implausible or truncated candidates and continue scanning.
                    if (dataLen > 500 || dataStart + dataLen > payload.length) {
                        pos += 2;
                        continue;
                    }

                    const data = payload.slice(dataStart, dataStart + dataLen);

                    // First 2 bytes are the embedded macro_index (1-based, matches user-facing number).
                    if (data.length >= 2) {
                        const macroNum = data.readUInt16BE(0);
                        const nameData = data.slice(2);
                        const textFields = nameData.toString('ascii').split('\x00');
                        const oled = (textFields[0] || '').trim();
                        const panel = (textFields[1] || '').trim();
                        const comment = (textFields[2] || '').trim();

                        if (macroNum >= 1 && macroNum <= 999) {
                            if (oled || panel || comment) {
                                this.macroCatalog.set(macroNum, {
                                    oled,
                                    panel,
                                    comment
                                });
                            } else {
                                // Empty macro - remove if it was previously named
                                this.macroCatalog.delete(macroNum);
                            }
                            found++;
                        }
                    }

                    // Advance past this entry
                    pos = dataStart + dataLen;
                    continue;
                }
            }
            pos++;
        }

        return found;
    }

    // Legacy V14 UDP macro catalog parser retained for protocol reference.
    // Not used by active code path because macro catalog names are treated as TCP/V16+ only.
    // Each entry: prevOID(4) + nextOID(4) + field_count(2) + data_len(2)
    //             + data: [macro_index(2) + name1\0 + name2\0 + name3\0]
    parseMacroCatalogDataV14(msg, pb, payLen) {
let found = 0;
        // Sub-header at pb is 16 bytes: sub_id(2) + flags(6) + sig(2) + params(2) + pad(4)
        // First packet may have a 12-byte zero sentinel entry after this which the loop skips naturally
        let pos = pb + 16;
        const endPos = pb + payLen;

        while (pos + 12 <= endPos) {
            // pos+0..3 = prevOID, pos+4..7 = nextOID (not used for macro number)
            // pos+8..9 = field_count (always 1 in practice), pos+10..11 = data_len
            const dataLen = msg.readUInt16BE(pos + 10);
            const dataStart = pos + 12;

            if (dataStart + dataLen > endPos) break;

            if (dataLen >= 2) {
                const macroIndex = msg.readUInt16BE(dataStart);
                // V14 UDP uses 1-based macro indices (1-999), not 0-based like TCP
                const macroNum = macroIndex;

                if (macroIndex >= 1 && macroIndex <= 999) {
                    // Parse null-separated name strings after the 2-byte macro index
                    const nameData = msg.slice(dataStart + 2, dataStart + dataLen);
                    const textFields = nameData.toString('ascii').split('\x00');
                    const oled = (textFields[0] || '').trim();
                    const panel = (textFields[1] || '').trim();
                    const comment = (textFields[2] || '').trim();

                    if (oled || panel || comment) {
                        this.macroCatalog.set(macroNum, {
                            oled,
                            panel,
                            comment
                        });
                    } else {
                        this.macroCatalog.delete(macroNum);
                    }
                    found++;
                }
            }

            pos += 12 + dataLen;
        }

        return found;
    }

    // Reset bulk load timer - called each time macro data arrives
    resetMacroCatalogBulkTimer() {
        if (this.macroCatalogBulkTimerId) {
            clearTimeout(this.macroCatalogBulkTimerId);
        }
        // After 2 seconds of no new macro data, consider bulk load complete
        this.macroCatalogBulkTimerId = setTimeout(() => {
            if (!this.macroCatalogReady && !this.isClosing) {
                this.macroCatalogReady = true;
                const namedCount = this.macroCatalog.size;
                this.stopMacroCatalogRetryLoop();
                this.emitter.emit('status', 'MACRO_CATALOG_READY', {
                    totalNamed: namedCount,
                    catalog: Object.fromEntries(this.macroCatalog)
                });

                // V14 UDP: defer macro status subscribe until catalog dump settles
                // (TCP already subscribed immediately — see startTcpConnection)
                if (this.protocol === 'udp' && !this.macroStatusSubscribed) {
                    this.subscribeMacroStatus();
                }
            }
        }, 2000);
    }

    // Get macro name (OLED) by number
    getMacroName(macroNum) {
        const entry = this.macroCatalog.get(macroNum);
        if (!entry) return null;
        return entry.oled || entry.panel || entry.comment || null;
    }

    // Get full macro catalog as plain object
    getMacroCatalog() {
        return Object.fromEntries(this.macroCatalog);
    }

    // Start UDP path (V14) - original handshake process
    async startUdp() {
        this.mainClient = dgram.createSocket('udp4');
        this.listenerClient = dgram.createSocket('udp4');

        this.setupMainClientHandlers();
        this.setupListenerClientHandlers();

        return new Promise((resolve, reject) => {
            let resolved = false;

            this.mainClient.bind(this.mainClientPort, () => {
                this.listenerClient.bind(this.listenerClientPort, () => {
                    this.emitter.emit('status', 'CONNECTING', 'Starting Initial Handshake...');
                    this.mainClient.send(this.payloadPacket1, this.initialServerPort, this.targetHost, (err) => {
                        if (err) {
                            this.emitter.emit('status', 'ERROR', `Error sending Packet 1: ${err.message}`);
                            reject(err);
                        } else {
                            this.mainHandshakeStage = 2;
                            this.startPacket1RetryTimer();
                            this.startHandshakeTimeout();
                            if (!resolved) {
                                resolved = true;
                                resolve(() => this.cleanup());
                            }
                        }
                    });
                });
            });
        });
    }
    
    setupMainClientHandlers() {
        this.mainClient.on('error', (err) => {
            this.emitter.emit('status', 'ERROR', `Main Client error: ${err.message}`);
            this.cleanup();
        });
        
        this.mainClient.on('message', (msg, rinfo) => {
            this.handleMainClientMessage(msg, rinfo);
        });
    }
    
    setupListenerClientHandlers() {
        this.listenerClient.on('error', (err) => {
            this.emitter.emit('status', 'ERROR', `Listener Client error: ${err.message}`);
            this.cleanup();
        });
        
        this.listenerClient.on('message', (msg, rinfo) => {
            this.handleListenerClientMessage(msg, rinfo);
        });
    }
    
    handleMainClientMessage(msg, rinfo) {
        // Handshake 1
        if (this.mainHandshakeStage === 2 && rinfo.port === this.initialServerPort && msg.equals(this.expectedPayloadPacket2)) {
            if (this.packet1RetryIntervalId) {
                clearInterval(this.packet1RetryIntervalId);
                this.packet1RetryIntervalId = null;
            }
            this.mainHandshakeStage = 3;
            this.mainClient.send(this.payloadPacket3, this.initialServerPort, this.targetHost);
        } else if (this.mainHandshakeStage === 3 && rinfo.port === this.initialServerPort && msg.equals(this.expectedPayloadPacket4)) {
            this.mainHandshakeStage = 4;
            this.mainClient.send(this.payloadPacket5, this.initialServerPort, this.targetHost);
        } else if (this.mainHandshakeStage === 4 && rinfo.port === this.initialServerPort && msg.equals(this.expectedPayloadPacket6)) {
            this.mainHandshakeStage = 5;
            if (this.announcedTargetPort > 0) {
                this.mainHandshakeStage = 6;
                this.mainClient.send(this.payloadPacket12, this.announcedTargetPort, this.targetHost);
            }
        }
        // Handshake 2
        else if (this.mainHandshakeStage === 6 && rinfo.port === this.announcedTargetPort && msg.equals(this.expectedPayloadPacket13)) {
            this.secondPhaseDynamicCommPort = rinfo.port;
            this.mainHandshakeStage = 7;
            this.mainClient.send(this.payloadPacket14, this.secondPhaseDynamicCommPort, this.targetHost);
        } else if (this.mainHandshakeStage === 7 && rinfo.port === this.secondPhaseDynamicCommPort && msg.equals(this.expectedPayloadPacket15)) {
            this.mainHandshakeStage = 8;
            const sequenceBuffer = Buffer.alloc(2);
            sequenceBuffer.writeUInt16BE(3, 0);
            const payloadPacket16 = Buffer.concat([this.payloadPacket16Base, sequenceBuffer, Buffer.alloc(2), this.payloadPacket16Client]);
            this.mainClient.send(payloadPacket16, this.secondPhaseDynamicCommPort, this.targetHost);
        } else if (this.mainHandshakeStage === 8 && rinfo.port === this.secondPhaseDynamicCommPort && msg.equals(this.expectedPayloadPacket17)) {
            if (this.handshakeOverallTimeoutId) {
                clearTimeout(this.handshakeOverallTimeoutId);
                this.handshakeOverallTimeoutId = null;
            }
            this.emitter.emit('status', 'HANDSHAKE_COMPLETE', 'Handshake complete, sending suite command...');
            this.mainHandshakeStage = 9;
            this.sendSuiteCommand();
            this.startHeartbeat();
            // Subscribe to frame info (V14 UDP)
            setTimeout(() => {
                if (!this.isClosing && this.protocol === 'udp') {
                    this.udpSubscribeFrameInfo();
                }
            }, 300);
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
                                this.subscribeMacroCatalog();
                            }
                        }, 500);
                    });
                } else if (!this.isClosing) {
                    // TCP path: subscribe directly
                    this.subscribeMacroCatalog();
                }
            }, 3400);
        }
        // Heartbeat/Macro phase
        else if (this.mainHandshakeStage === 9 && rinfo.port === this.secondPhaseDynamicCommPort) {
            // ACK inbound data/control packets (0x0001/0x0004/0x0006). Do NOT ACK 0x0002 (those
            // are the frame's ACKs/heartbeat responses — handled below).
            if (msg.length >= 4) {
                const pktType = msg.readUInt16BE(0);
                if (pktType === 0x0001 || pktType === 0x0004 || pktType === 0x0006) {
                    this.mainClient.send(this.buildAck(msg), rinfo.port, rinfo.address);
                }
            }

            if (this.lastSentMacroId !== null && msg.length === 4 && msg[0] === 0x00 && msg[1] === 0x02 && msg[2] === 0x03 && msg[3] === this.lastSentMacroId) {
                this.emitter.emit('status', 'MACRO_ACK', `${this.lastSentMacroId}`);
                this.lastSentMacroId = null;
            } else if (msg.equals(this.expectedServerHeartbeatResponse)) {
                const currentTime = Date.now();
                if (this.lastHeartbeatResponseTime === 0) {
                    this.lastHeartbeatResponseTime = currentTime;
                    setTimeout(() => {
                        if (this.mainHandshakeStage === 9 && !this.isClosing) {
                            this.fullyConnected = true;
                            this.emitter.emit('status', 'CONNECTED', 'Heartbeat established.');
                            this.announceIdentity();
                        }
                    }, 2000);
                } else {
                    this.lastHeartbeatResponseTime = currentTime;
                    // Emit heartbeat ACK for visual indicator
                    this.emitter.emit('status', 'HEARTBEAT_ACK', 'Heartbeat acknowledged.');
                }
                this.missedHeartbeats = 0;
            } else if (msg.length > 4) {
                // Try to parse frame info from any data packet (V14 UDP)
                if (!this.frameVersion) {
                    const info = this.parseFrameInfo(msg.slice(4)); // Skip 4-byte DATA header
                    if (info.version) {
                        this.frameVersion = info.version;
                        this.frameName = info.name;
                        this.frameBuildDate = info.buildDate;
                        this.emitter.emit('status', 'FRAME_VERSION', {
                            version: info.version,
                            name: info.name,
                            buildDate: info.buildDate
                        });
                    }
                }
                // Handle subscription data (AUX/ME bus updates)
                this.handleSubscriptionData(msg);
            }
        }
    }
    
    handleListenerClientMessage(msg, rinfo) {
        if (rinfo.port === this.portAnnounceServerPort) {
            // Port announcement handshake (from port 5001)
            if (msg.equals(this.expectedPayloadPacket7)) {
                this.listenerClient.send(this.payloadPacket8, rinfo.port, rinfo.address);
            } else if (msg.length >= 20) {
                const newlyAnnouncedPort = msg.readUInt16BE(18);
                if (newlyAnnouncedPort > 0 && newlyAnnouncedPort < 65536) {
                    this.announcedTargetPort = newlyAnnouncedPort;
                    this.listenerClient.send(this.expectedPayloadPacket10, rinfo.port, rinfo.address, (err) => {
                        if (!err) {
                            if (this.mainHandshakeStage === 5) {
                                this.mainHandshakeStage = 6;
                                this.mainClient.send(this.payloadPacket12, this.announcedTargetPort, this.targetHost);
                            }
                            // NOTE: Do NOT close the listener socket here.
                            // The frame sends subscription data back on the listener port
                            // from a dynamically assigned port (e.g., 5203).
                        }
                    });
                }
            }
        } else if (rinfo.address === this.targetHost) {
            // Data from the frame on a port other than 5001 (e.g., subscription data channel)
            if (msg.length === 4 && msg.equals(this.expectedPayloadPacket7)) {
                // Channel-establish (00010000) — response is 00020000 which is byte-identical
                // to an ACK of seq 0. No behavior change from the type-gated rule below.
                this.subscriptionDataPort = rinfo.port;
                this.listenerClient.send(this.payloadPacket8, rinfo.port, rinfo.address);
                this.emitter.emit('status', 'AUX_DATA_CHANNEL', `Subscription data channel established on port ${rinfo.port}`);
            } else if (msg.length >= 4) {
                // ACK inbound data/control packets by type (matches engine.py listener ACK rule).
                const pktType = msg.readUInt16BE(0);
                if (pktType === 0x0001 || pktType === 0x0004 || pktType === 0x0006) {
                    this.listenerClient.send(this.buildAck(msg), rinfo.port, rinfo.address);
                }

                if (msg.length > 4) {
                    if (!this.frameVersion) {
                        const info = this.parseFrameInfo(msg.slice(4));
                        if (info.version) {
                            this.frameVersion = info.version;
                            this.frameName = info.name;
                            this.frameBuildDate = info.buildDate;
                            this.emitter.emit('status', 'FRAME_VERSION', {
                                version: info.version,
                                name: info.name,
                                buildDate: info.buildDate
                            });
                        }
                    }
                    this.handleSubscriptionData(msg);
                }
            }
        }
    }
    
    sendSuiteCommand() {
        if (this.suite && this.suiteCommands[this.suite]) {
            if (this.protocol === 'tcp') {
                this.tcpSelectSuite();
            } else {
                const suiteCommandMessages = this.suiteCommands[this.suite];
                this.mainClient.send(suiteCommandMessages[0], this.secondPhaseDynamicCommPort, this.targetHost, (err) => {
                    if (!err && suiteCommandMessages.length > 1) {
                        setTimeout(() => {
                            this.mainClient.send(suiteCommandMessages[1], this.secondPhaseDynamicCommPort, this.targetHost);
                        }, 100);
                    }
                });
            }
        }
    }

    // Send frame info subscription over UDP (sub_id 0x01fd, matching Python reference)
    udpSubscribeFrameInfo() {
        if (!this.mainClient || this.isClosing || this.secondPhaseDynamicCommPort === 0) return;
        this.udpMsgCounter = (this.udpMsgCounter || 0) + 1;
        const pkt = Buffer.alloc(52);
        let off = 0;
        // DATA header: 0004 + msg_counter
        pkt.writeUInt16BE(0x0004, off); off += 2;
        pkt.writeUInt16BE(this.udpMsgCounter, off); off += 2;
        // Subscribe command header
        pkt.writeUInt16BE(0x0002, off); off += 2; // type
        pkt.writeUInt16BE(0x0008, off); off += 2; // cmd (SUBSCRIBE)
        pkt.writeUInt32BE(0x00000024, off); off += 4; // header_len
        pkt.writeUInt32BE(0x0000002e, off); off += 4; // total_len
        // 16 zero bytes padding (already zero from alloc)
        off += 16;
        // sub_id 0x01fd + flags
        pkt.writeUInt16BE(0x01fd, off); off += 2;
        Buffer.from([0x00,0x01,0x00,0x04,0x00,0x02,0x00,0x00,0x00,0x00]).copy(pkt, off); off += 10;
        // sig + params
        Buffer.from([0x00,0x08,0x00,0x01,0x01,0x00,0x00,0x01]).copy(pkt, off);
        this.mainClient.send(pkt, this.secondPhaseDynamicCommPort, this.targetHost);
    }

    startHeartbeat() {
        this.lastHeartbeatResponseTime = 0;
        this.missedHeartbeats = 0;
        
        if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
        this.heartbeatIntervalId = setInterval(() => {
            if (this.mainHandshakeStage === 9 && !this.isClosing) {
                this.missedHeartbeats++;
                if (this.missedHeartbeats >= this.MAX_MISSED_HEARTBEATS) {
                    this.emitter.emit('status', 'HEARTBEAT_TIMEOUT', 'Connection lost after 5 missed heartbeats.');
                    this.cleanup();
                    return;
                }
                this.mainClient.send(this.clientHeartbeatPayload, this.secondPhaseDynamicCommPort, this.targetHost);
            } else {
                clearInterval(this.heartbeatIntervalId);
            }
        }, this.heartbeatIntervalMs);
    }
    
    startPacket1RetryTimer() {
        this.packet1RetryIntervalId = setInterval(() => {
            if (this.mainHandshakeStage === 2 && !this.isClosing) {
                this.mainClient.send(this.payloadPacket1, this.initialServerPort, this.targetHost);
            } else {
                clearInterval(this.packet1RetryIntervalId);
                this.packet1RetryIntervalId = null;
            }
        }, 1000);
    }
    
    startHandshakeTimeout() {
        if (this.handshakeOverallTimeoutId) clearTimeout(this.handshakeOverallTimeoutId);
        this.handshakeOverallTimeoutId = setTimeout(() => {
            this.emitter.emit('status', 'HANDSHAKE_TIMEOUT_ERROR', "Couldn't connect (timeout)");
            this.cleanup();
        }, this.handshakeTimeoutMs);
    }
    
    cleanup() {
        if (this.isClosing) return;
        this.isClosing = true;
        this.fullyConnected = false; // Reset fully connected flag
        this.frameVersion = null;    // Reset frame version
        this.macroCatalog.clear();   // Clear macro catalog
        this.macroCatalogReady = false;
        this.macroCatalogSubscribed = false;
        this.macroCatalogDataSeen = false;
        this.macroCatalogSubscribeAttempts = 0;
        if (this.macroCatalogBulkTimerId) clearTimeout(this.macroCatalogBulkTimerId);
        this.stopMacroCatalogRetryLoop();
        this.macroStatus.clear();
        this.lastPlayedMacro = null;
        this.runSeq++;
        this.macroStatusSubscribed = false;
        if (this.macroStatusDeferTimerId) {
            clearTimeout(this.macroStatusDeferTimerId);
            this.macroStatusDeferTimerId = null;
        }
        // (no optimistic timer to clear — frame is sole source of truth)
        this.subscribedAuxes.clear(); // Reset subscription tracking so we re-subscribe on reconnect
        this.auxState.clear();        // Clear cached AUX state
        this.subscribedMEs.clear();   // Reset ME subscription tracking
        this.meState.clear();         // Clear cached ME state
        this.emitter.emit('status', 'DISCONNECTED', 'Closing connection...');

        if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
        if (this.packet1RetryIntervalId) clearInterval(this.packet1RetryIntervalId);
        if (this.heartbeatTimeoutId) clearTimeout(this.heartbeatTimeoutId);
        if (this.handshakeOverallTimeoutId) clearTimeout(this.handshakeOverallTimeoutId);
        if (this.tcpHeartbeatCheckId) clearInterval(this.tcpHeartbeatCheckId);
        if (this.tcpActiveHeartbeatId) clearInterval(this.tcpActiveHeartbeatId);

        // Close TCP socket
        try {
            if (this.tcpSocket) {
                this.tcpSocket.destroy();
                this.tcpSocket = null;
            }
        } catch (e) { /* Ignore */ }

        // Close UDP sockets
        try {
            if (this.mainClient && typeof this.mainClient.address === 'function') {
                try {
                    if (this.mainClient.address()) this.mainClient.close();
                } catch (e) { /* Ignore */ }
            }
        } catch (e) { /* Ignore */ }

        try {
            if (this.listenerClient && typeof this.listenerClient.address === 'function') {
                try {
                    if (this.listenerClient.address()) this.listenerClient.close();
                } catch (e) { /* Ignore */ }
            }
        } catch (e) { /* Ignore */ }
    }
    
    // Build a 4-byte ACK: 0x0002 + echoed sequence bytes [2..3] from the inbound packet.
    buildAck(msg) {
        const ack = Buffer.alloc(4);
        ack.writeUInt16BE(0x0002, 0);
        msg.copy(ack, 2, 2, 4);
        return ack;
    }

    // Protocol-aware send: strips UDP DATA header for TCP, wraps in session framing
    sendToFrame(buffer, callback) {
        if (this.protocol === 'tcp') {
            if (!this.tcpSocket || this.isClosing) {
                if (callback) callback(new Error('TCP socket not available'));
                return;
            }
            const rdpPayload = buffer.slice(4);
            const wrapped = this.tcpWrap(rdpPayload);
            this.tcpSocket.write(wrapped, callback);
        } else {
            if (!this.mainClient || !this.secondPhaseDynamicCommPort || !this.targetHost) {
                if (callback) callback(new Error('UDP socket not available'));
                return;
            }
            this.mainClient.send(buffer, this.secondPhaseDynamicCommPort, this.targetHost, callback);
        }
    }

    // Command methods
    sendMacro(macroNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        // Validate macro number (1-999)
        if (typeof macroNum !== 'number' || macroNum < 1 || macroNum > 999) {
            return { success: false, message: 'Invalid macro number (must be 1-999).' };
        }

        // Decide Play vs Continue based on live macro status
        const currentStatus = this.macroStatus.get(macroNum);
        const eid = (currentStatus === 7) ? 0x0042 : 0x0002; // Paused → Continue, else Play
        const verb = (eid === 0x0042) ? 'Continue' : 'Play';

        // Generate a unique ID
        const macroIdNum = this.generateUniqueId();
        const macroPayload = this.createMacroPayload(macroNum, macroIdNum, eid);

        this.macroQueue.push({ macroNum, macroPayload, macroIdNum, eid });

        // If not already processing, start the queue
        if (!this.isSendingMacro) {
            this.processMacroQueue();
        }

        return { success: true, message: `Macro ${macroNum} ${verb} command sent.` };
    }

    sendMacroStop(macroNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        if (typeof macroNum !== 'number' || macroNum < 1 || macroNum > 999) {
            return { success: false, message: 'Invalid macro number (must be 1-999).' };
        }
        const macroIdNum = this.generateUniqueId();
        const macroPayload = this.createMacroPayload(macroNum, macroIdNum, 0x0003);
        this.macroQueue.push({ macroNum, macroPayload, macroIdNum, eid: 0x0003 });
        if (!this.isSendingMacro) this.processMacroQueue();
        return { success: true, message: `Macro ${macroNum} Stop command sent.` };
    }

    sendMacroStopAll() {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        // Official K-Frame Macro Control Stop-All: normal Stop event with the
        // all-macros sentinel, including macros paused at a User Wait.
        const payload = this.buildSetEvent(0x0003, 0x77000000, Buffer.from([0xff, 0xff, 0xff, 0xff]));
        this.sendToFrame(payload, (err) => {
            if (err) {
                this.emitter.emit('status', 'ERROR', `Error sending macro stop-all: ${err.message}`);
            } else {
                this.emitter.emit('status', 'MACRO_STOP_ALL_SENT', 'Stop-All sent');
                this.macroStatus.clear();
                this.runSeq++;
                this.emitter.emit('status', 'MACRO_STATUS_CHANGED', {
                    macroStatus: Object.fromEntries(this.macroStatus),
                    lastPlayedMacro: this.lastPlayedMacro,
                    runSeq: this.runSeq
                });
            }
        });
        return { success: true, message: 'Macro Stop-All command sent.' };
    }

    generateUniqueId() {
        let attempts = 0;
        let candidateId;
        
        do {
            candidateId = this.nextMacroId;
            this.nextMacroId = (this.nextMacroId + 1) % 256;
            
            attempts++;
            if (attempts > 256) {
                if (this.recentlyUsedIds.length > 0) {
                    candidateId = this.recentlyUsedIds.shift();
                }
                break;
            }
        } while (this.recentlyUsedIds.includes(candidateId));
        
        this.recentlyUsedIds.push(candidateId);
        
        if (this.recentlyUsedIds.length > this.MAX_TRACKED_IDS) {
            this.recentlyUsedIds.shift();
        }
        
        return candidateId;
    }
    
    createMacroPayload(macroNumber, macroIdNum, eid = 0x0002) {
        const data = Buffer.alloc(4);
        data.writeUInt16BE(macroNumber - 1, 0);
        // data[2..3] = 0x0000 (runSource = 0, live-verified)
        return this.buildSetEvent(eid, 0x77000000, data, 0x0300 | macroIdNum);
    }
    
    processMacroQueue() {
        if (this.isSendingMacro || this.macroQueue.length === 0 || this.isClosing || this.mainHandshakeStage !== 9) {
            return;
        }

        this.isSendingMacro = true;
        const { macroNum, macroPayload, macroIdNum, eid } = this.macroQueue.shift();

        this.lastSentMacroId = macroIdNum;

        this.sendToFrame(macroPayload, (err) => {
            if (err) {
                this.emitter.emit('status', 'MACRO_ERROR', `${macroNum} ${err.message}`);
                this.lastSentMacroId = null;
            } else {
                this.emitter.emit('status', 'MACRO_SENT', `${macroNum} ${macroPayload.toString('hex')}`);
                this.afterMacroFire(macroNum, eid);
            }
            setTimeout(() => {
                this.isSendingMacro = false;
                this.processMacroQueue();
            }, this.macroSendDelayMs);
        });
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
    afterMacroFire(macroNum, eid) {
        let changed = false;

        if (eid === 0x0002) {
            this.lastPlayedMacro = macroNum;
            changed = true;
        } else if (eid === 0x0042) {
            if (this.macroStatus.has(macroNum)) {
                this.macroStatus.delete(macroNum);
            }
            changed = true;
        } else if (eid === 0x0003) {
            if (this.macroStatus.has(macroNum)) {
                this.macroStatus.delete(macroNum);
            }
            changed = true;
        }

        if (changed) {
            this.runSeq++;
            this.emitter.emit('status', 'MACRO_STATUS_CHANGED', {
                macroStatus: Object.fromEntries(this.macroStatus),
                lastPlayedMacro: this.lastPlayedMacro,
                runSeq: this.runSeq
            });
        }
    }
    
    sendAuxRoute(auxNum, sourceNum, transitionType = 'cut') {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        // Validate aux number (1-96)
        if (typeof auxNum !== 'number' || auxNum < 1 || auxNum > 96) {
            return { success: false, message: 'Invalid aux number (must be 1-96).' };
        }

        // Validate source number (1-850)
        if (typeof sourceNum !== 'number' || sourceNum < 1 || sourceNum > 850) {
            return { success: false, message: 'Invalid source number (must be 1-850).' };
        }

        try {
            const auxIndex = auxNum - 1;
            let transByte;
            switch (transitionType) {
                case 'mix':  transByte = 0x01; break;
                case 'wipe': transByte = 0x02; break;
                default:     transByte = 0x00; break;
            }
            const data = Buffer.alloc(4);
            data.writeUInt16BE(sourceNum, 0);
            data[2] = transByte;
            data[3] = 0x01;
            const payload = this.buildSetEvent(0x007E, 0x19000100 + auxIndex, data);

            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending aux route: ${err.message}`);
                } else {
                    const previousSource = this.auxState.get(auxNum) || null;
                    this.auxState.set(auxNum, sourceNum);
                    if (previousSource !== sourceNum) {
                        this.emitter.emit('auxStateChanged', {
                            auxNum,
                            previousSource,
                            currentSource: sourceNum
                        });
                    }
                    this.emitter.emit('status', 'AUX_ROUTE_SENT', `Aux ${auxNum} -> Source ${sourceNum} (${transitionType})`);
                }
            });

            return { success: true, message: `Routing Aux ${auxNum} to Source ${sourceNum} (${transitionType})` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }
    
    sendImageStore(outputNum, imageNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        
        // Validate output number (1-10)
        if (typeof outputNum !== 'number' || outputNum < 1 || outputNum > 10) {
            return { success: false, message: 'Invalid output number (must be 1-10).' };
        }
        
        // Validate image number (1-8999)
        if (typeof imageNum !== 'number' || imageNum < 1 || imageNum > 8999) {
            return { success: false, message: 'Invalid image number (must be 1-8999).' };
        }
        
        try {
            const data = Buffer.alloc(4);
            data.writeUInt32BE(imageNum, 0);
            const payload = this.buildSetParam(0x1730, 0x0400, 0x43000010 + outputNum, data);

            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending image store: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'IMAGE_STORE_SENT', `Output ${outputNum} -> Image ${imageNum}`);
                }
            });

            return { success: true, message: `Setting Output ${outputNum} to Image ${imageNum}` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    sendImageStoreInput(inputNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        if (typeof inputNum !== 'number' || inputNum < 1 || inputNum > 850) {
            return { success: false, message: 'Invalid input number (must be 1-850).' };
        }

        try {
            const data = Buffer.alloc(2);
            data.writeUInt16BE(inputNum, 0);
            const payload = this.buildSetParam(0x104A, 0x0100, 0x8C001601, data);

            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending image store input: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'IMAGE_STORE_INPUT_SENT', `Input -> ${inputNum}`);
                }
            });

            return { success: true, message: `Setting Image Store input to ${inputNum}` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    sendEMem(eMemNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        if (typeof eMemNum !== 'number' || eMemNum < 0 || eMemNum > 999) {
            return { success: false, message: 'Invalid EMEM number (must be 0-999).' };
        }

        try {
            const data = Buffer.alloc(7);
            data.writeUInt16BE(eMemNum, 4);
            const payload = this.buildSetEvent(0x0041, 0x35000001, data);

            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending EMEM: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'EMEM_SENT', `EMEM ${eMemNum}`);
                }
            });

            return { success: true, message: `EMEM ${eMemNum} sent` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }
    
    sendRawCommand(hexCommand) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        if (!hexCommand || typeof hexCommand !== 'string') {
            return { success: false, message: 'Invalid hex command.' };
        }

        try {
            const hex = hexCommand.trim().toLowerCase();
            if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0)
                return { success: false, message: 'Raw command is not valid hex.' };
            if (hex.length < 32)
                return { success: false, message: 'Raw command too short.' };
            if (!hex.startsWith('0004'))
                return { success: false, message: 'Raw command must start with UDP DATA header 0004.' };
            const cmd = hex.substring(12, 16);
            if (!['0005', '0006', '0008', '0020'].includes(cmd))
                return { success: false, message: `Unsupported CPL command 0x${cmd}.` };

            const messageId = this.generateUniqueAuxId();
            const messageIdHex = messageId.toString(16).padStart(4, '0');
            const modifiedHexCommand = hex.substring(0, 4) + messageIdHex + hex.substring(8);

            const payload = Buffer.from(modifiedHexCommand, 'hex');

            // Send command
            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending raw command: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'RAW_COMMAND_SENT', `Command sent`);
                }
            });

            return { success: true, message: `Raw command sent` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    sendPanelMem(panelMemNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        if (typeof panelMemNum !== 'number' || panelMemNum < 1 || panelMemNum > 99) {
            return { success: false, message: 'Invalid panel memory number (must be 1-99).' };
        }

        try {
            const data = Buffer.alloc(2);
            data.writeUInt16BE(panelMemNum, 0);
            const payload = this.buildSetParam(0x14D2, 0x0300, 0x22000000, data);

            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending panel memory: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'PANEL_MEM_SENT', `Panel Memory ${panelMemNum}`);
                }
            });

            return { success: true, message: `Panel Memory ${panelMemNum} sent` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    sendCrosspoint(pid, did, sourceNum) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        if (pid !== 0x104A && pid !== 0x103A) {
            return { success: false, message: 'Invalid crosspoint PID.' };
        }
        if (typeof sourceNum !== 'number' || sourceNum < 1 || sourceNum > 809) {
            return { success: false, message: 'Invalid source number (must be 1-809).' };
        }
        try {
            const data = Buffer.alloc(2);
            data.writeUInt16BE(sourceNum, 0);
            const payload = this.buildSetParam(pid, 0x0100, did, data);
            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending crosspoint: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'CROSSPOINT_SENT', `PID 0x${pid.toString(16)} DID 0x${did.toString(16)} src ${sourceNum}`);
                }
            });
            return { success: true, message: `Crosspoint sent` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    sendTransitionEvent(eid, did) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        if (eid !== 0x0043 && eid !== 0x0044) {
            return { success: false, message: 'Invalid transition EID.' };
        }
        try {
            const payload = this.buildSetEvent(eid, did);
            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending transition: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'TRANSITION_SENT', `EID 0x${eid.toString(16)} DID 0x${did.toString(16)}`);
                }
            });
            return { success: true, message: `Transition event sent` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    sendEMemTargeted(eMemNum, did, mode) {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }
        if (typeof eMemNum !== 'number' || eMemNum < 0 || eMemNum > 999) {
            return { success: false, message: 'Invalid EMEM number (must be 0-999).' };
        }
        if (typeof mode !== 'number' || mode < 0 || mode > 2) {
            return { success: false, message: 'Invalid EMEM mode (must be 0-2).' };
        }
        try {
            const data = Buffer.alloc(8);
            data.writeUInt16BE(eMemNum, 4);
            data.writeUInt16BE(mode, 6);
            const payload = this.buildSetEvent(0x0041, did, data);
            this.sendToFrame(payload, (err) => {
                if (err) {
                    this.emitter.emit('status', 'ERROR', `Error sending targeted EMEM: ${err.message}`);
                } else {
                    this.emitter.emit('status', 'EMEM_TARGETED_SENT', `EMEM ${eMemNum} DID 0x${did.toString(16)} mode ${mode}`);
                }
            });
            return { success: true, message: `Targeted EMEM ${eMemNum} sent` };
        } catch (error) {
            return { success: false, message: `Error creating command: ${error.message}` };
        }
    }

    // ─── AUX Bus Subscription Methods ────────────────────────────────────

    /**
     * Get suite offset for bus byte calculation
     * Bus byte = 0x50 + suiteOffset for AUX buses
     */
    getSuiteOffset() {
        switch (this.suite) {
            case 'suite1a': case 'suite1b': return 0;
            case 'suite2a': case 'suite2b': return 1;
            case 'suite3a': case 'suite3b': return 2;
            case 'suite4a': case 'suite4b': return 3;
            default: return 0;
        }
    }

    /**
     * Build a subscription packet for a single AUX bus source selection (0x104a).
     * Per GV K-Frame protocol: one 52-byte packet per AUX bus, marker 0x19.
     * @param {number} busIndex - AUX bus index 0-95 (0x00-0x5f)
     */
    buildAuxSubscriptionPacket(busIndex) {
        const seqNum = this.subscriptionSequence++;
        const subId = this.nextSubscriptionId++;

        const packet = Buffer.alloc(52);
        let offset = 0;

        // Bytes 0-31: Standard subscription header (identical for all types)
        packet.writeUInt16BE(0x0004, offset); offset += 2;      // 0-1:   Packet type (DATA)
        packet.writeUInt16BE(seqNum, offset); offset += 2;      // 2-3:   Sequence number
        packet.writeUInt16BE(0x0002, offset); offset += 2;      // 4-5:   Sub-command
        packet.writeUInt16BE(0x0008, offset); offset += 2;      // 6-7:   Command (SUBSCRIBE)
        packet.writeUInt32BE(0x00000024, offset); offset += 4;  // 8-11:  Payload length (36)
        packet.writeUInt32BE(0x0000002e, offset); offset += 4;  // 12-15: Secondary length (46)
        offset += 16;                                            // 16-31: Padding (zeros)

        // Bytes 32-51: AUX subscription parameters
        packet.writeUInt16BE(subId, offset); offset += 2;       // 32-33: Subscription ID
        packet.writeUInt16BE(0x0001, offset); offset += 2;      // 34-35: Flag
        packet.writeUInt16BE(0x0003, offset); offset += 2;      // 36-37: Flag
        packet.writeUInt16BE(0x0003, offset); offset += 2;      // 38-39: Flag
        packet.writeUInt32BE(0x00000000, offset); offset += 4;  // 40-43: Reserved (zeros)
        packet.writeUInt16BE(0x104a, offset); offset += 2;      // 44-45: Signature
        packet.writeUInt16BE(0x0000, offset); offset += 2;      // 46-47: Read flags
        packet.writeUInt8(0x19, offset); offset += 1;           // 48:    Marker byte (AUX)
        packet.writeUInt16BE(0x0000, offset); offset += 2;      // 49-50: Address (PGM layer)
        packet.writeUInt8(busIndex, offset); offset += 1;       // 51:    AUX bus index

        return { packet, subId };
    }

    /**
     * Build a subscription packet for a single ME bus source selection (0x104a).
     * Per GV K-Frame protocol: one 52-byte packet per ME bus, marker 0x04.
     * @param {number} address - ME address byte: (bus_code << 4) | me_num
     *   bus_code: A=0, B=1, C=2, D=3
     *   me_num: ME1=0, ME2=1, ME3=2, PGM=3, ME4=4
     */
    buildMESubscriptionPacket(address) {
        const seqNum = this.subscriptionSequence++;
        const subId = this.nextSubscriptionId++;

        const packet = Buffer.alloc(52);
        let offset = 0;

        // Bytes 0-31: Standard subscription header (identical for all types)
        packet.writeUInt16BE(0x0004, offset); offset += 2;      // 0-1:   Packet type (DATA)
        packet.writeUInt16BE(seqNum, offset); offset += 2;      // 2-3:   Sequence number
        packet.writeUInt16BE(0x0002, offset); offset += 2;      // 4-5:   Sub-command
        packet.writeUInt16BE(0x0008, offset); offset += 2;      // 6-7:   Command (SUBSCRIBE)
        packet.writeUInt32BE(0x00000024, offset); offset += 4;  // 8-11:  Payload length (36)
        packet.writeUInt32BE(0x0000002e, offset); offset += 4;  // 12-15: Secondary length (46)
        offset += 16;                                            // 16-31: Padding (zeros)

        // Bytes 32-51: ME subscription parameters
        packet.writeUInt16BE(subId, offset); offset += 2;       // 32-33: Subscription ID
        packet.writeUInt16BE(0x0001, offset); offset += 2;      // 34-35: Flag
        packet.writeUInt16BE(0x0003, offset); offset += 2;      // 36-37: Flag
        packet.writeUInt16BE(0x0003, offset); offset += 2;      // 38-39: Flag
        packet.writeUInt32BE(0x00000000, offset); offset += 4;  // 40-43: Reserved (zeros)
        packet.writeUInt16BE(0x104a, offset); offset += 2;      // 44-45: Signature
        packet.writeUInt16BE(0x0000, offset); offset += 2;      // 46-47: Read flags
        packet.writeUInt8(0x04, offset); offset += 1;           // 48:    Marker byte (ME)
        packet.writeUInt16BE(0x0000, offset); offset += 2;      // 49-50: Reserved
        packet.writeUInt8(address, offset); offset += 1;        // 51:    ME address byte

        return { packet, subId };
    }

    /**
     * Subscribe to AUX bus source selection updates.
     * Sends 96 individual subscription packets (one per AUX bus, 0x00-0x5f).
     * Pauses 5ms every 16 packets to prevent UDP flooding.
     */
    subscribeToAuxBus() {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        // Only subscribe once per connection
        if (this.subscribedAuxes.has('all')) {
            return { success: true, message: 'Already subscribed to AUX bus.' };
        }

        try {
            // Send one packet per 50ms to avoid CPLScheduler buffer overflow
            let busIdx = 0;
            const sendNext = () => {
                if (this.isClosing || busIdx >= 96) {
                    if (busIdx >= 96) {
                        this.subscribedAuxes.add('all');
                        this.emitter.emit('status', 'AUX_SUBSCRIBED', `Subscribed to all 96 AUX buses`);
                    }
                    return;
                }
                const { packet, subId } = this.buildAuxSubscriptionPacket(busIdx);
                this.auxSubscriptionIds.set(subId, busIdx + 1);
                this.sendToFrame(packet);
                busIdx++;
                setTimeout(sendNext, 50);
            };
            sendNext();
            return { success: true, message: 'AUX subscription in progress (96 buses)' };
        } catch (error) {
            return { success: false, message: `Error creating subscription: ${error.message}` };
        }
    }

    /**
     * Subscribe to ME bus source selection updates.
     * Sends 20 individual subscription packets:
     *   4 buses (A=0, B=1, C=2, D=3) × 5 MEs (ME1=0, ME2=1, ME3=2, PGM=3, ME4=4)
     * Pauses 5ms every 16 packets to prevent UDP flooding.
     */
    subscribeToMEBus() {
        if (this.isClosing || this.mainHandshakeStage !== 9) {
            return { success: false, message: 'Not connected.' };
        }

        if (this.subscribedMEs.has('all')) {
            return { success: true, message: 'Already subscribed to ME bus.' };
        }

        try {
            // Build list of all 20 ME addresses
            const addresses = [];
            for (let busCode = 0; busCode <= 3; busCode++) {       // A=0, B=1, C=2, D=3
                for (let meNum = 0; meNum <= 4; meNum++) {         // ME1=0, ME2=1, ME3=2, PGM=3, ME4=4
                    addresses.push((busCode << 4) | meNum);
                }
            }

            // Send one packet per 50ms to avoid CPLScheduler buffer overflow
            let idx = 0;
            const sendNext = () => {
                if (this.isClosing || idx >= addresses.length) {
                    if (idx >= addresses.length) {
                        this.subscribedMEs.add('all');
                        this.emitter.emit('status', 'ME_SUBSCRIBED', `Subscribed to all 20 ME buses`);
                    }
                    return;
                }
                const addr = addresses[idx];
                const { packet, subId } = this.buildMESubscriptionPacket(addr);
                this.meSubscriptionIds.set(subId, addr);
                this.sendToFrame(packet);
                idx++;
                setTimeout(sendNext, 50);
            };
            sendNext();
            return { success: true, message: 'ME subscription in progress (20 buses)' };
        } catch (error) {
            return { success: false, message: `Error creating ME subscription: ${error.message}` };
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
    handleSubscriptionData(msg) {
        if (msg.length < 8) return;

        try {
            let offset = 4; // Skip outer header (cmd_type + sequence)

            while (offset + 12 <= msg.length) {
                const subCmd = msg.readUInt16BE(offset);
                const respType = msg.readUInt16BE(offset + 2);
                const payLen = msg.readUInt32BE(offset + 4);
                // const secLen = msg.readUInt32BE(offset + 8);

                if (offset + 12 + payLen > msg.length) break; // Truncated packet

                if (respType === 0x0010 && payLen >= 16) {
                    const pb = offset + 12; // Payload base

                    // Dispatch by subscription type
                    const firstWord = msg.readUInt16BE(pb);

                    if (firstWord === 0x0210) {
                        // Source definition response — engineering names
                        this.parseSourceDefResponse(msg, pb, payLen);
                    } else if (firstWord === 0x020b) {
                        // Source name response — operator-customized names (OLED, panel, menu)
                        this.parseSourceNameResponse(msg, pb, payLen);
                    } else if (firstWord === 0x0208) {
                        // Macro catalog response (TCP/V16+) — address-based entries
                        if (this.macroCatalogSubscribed) {
                            const payload = msg.slice(pb, pb + payLen);
                            const found = this.parseMacroCatalogData(payload);
                            if (found > 0) {
                                this.macroCatalogDataSeen = true;
                                this.stopMacroCatalogRetryLoop();
                                this.resetMacroCatalogBulkTimer();
                            }
                        }
                    } else if (firstWord === 0x020f) {
                        if (this.macroCatalogSubscribed) {
                            const found = this.parseMacroCatalogDataV14(msg, pb, payLen);
                            if (found > 0) {
                                this.macroCatalogDataSeen = true;
                                this.stopMacroCatalogRetryLoop();
                                this.resetMacroCatalogBulkTimer();
                            }
                        }
                    } else if (firstWord === 0x0234 || firstWord === 0x0235) {
                        if (this.macroStatusSubscribed) {
                            this.parseMacroStatusData(msg, pb, payLen);
                        }
                    } else {
                        // AUX/ME response: signature at pb+8, marker at pb+12
                        const signature = msg.readUInt16BE(pb + 8);
                        const marker = msg[pb + 12];

                        if (signature === 0x104a && marker === 0x19) {
                            // AUX response
                            const bus = msg[pb + 15];                    // Bus index (0-95)
                            const sourceNum = msg.readUInt16BE(pb + 20); // Source value
                            const auxNum = bus + 1;                      // Convert to 1-based

                            if (auxNum >= 1 && auxNum <= 96 && sourceNum > 0) {
                                const previousSource = this.auxState.get(auxNum) || null;

                                if (previousSource !== sourceNum) {
                                    this.auxState.set(auxNum, sourceNum);
                                    this.emitter.emit('auxStateChanged', {
                                        auxNum,
                                        previousSource,
                                        currentSource: sourceNum
                                    });
                                }
                            }
                        } else if (signature === 0x104a && marker === 0x04) {
                            // ME Bus response — track state and emit changes
                            const addr = msg[pb + 15];
                            const sourceNum = msg.readUInt16BE(pb + 20);

                            if (sourceNum > 0) {
                                const previousSource = this.meState.get(addr) || null;

                                if (previousSource !== sourceNum) {
                                    this.meState.set(addr, sourceNum);
                                    this.emitter.emit('meStateChanged', {
                                        address: addr,
                                        previousSource,
                                        currentSource: sourceNum
                                    });
                                }
                            }
                        }
                    }
                }

                offset += 12 + payLen;
            }
        } catch (e) {
            this.emitter.emit('status', 'SUB_PARSE_ERROR', e.message);
        }
    }

    /**
     * Parse 0x020b source name response.
     * Records contain source ID + 6 null-terminated strings (OLED, short, eng, panel, menu, unused).
     * Record wrappers: 12 bytes (range_start[4] + range_end[4] + prefix[2] + record_length[2]).
     */
    parseSourceNameResponse(msg, pb, payLen) {
        let namesUpdated = 0;
        try {
            // Records start at pb + 16 (after the 16-byte response header area)
            let pos = pb + 16;
            const endPos = pb + payLen;

            while (pos + 12 <= endPos) {
                // Record wrapper
                // const rangeStart = msg.readUInt32BE(pos);
                // const rangeEnd = msg.readUInt32BE(pos + 4);
                const prefix = msg.readUInt16BE(pos + 8);
                const recLen = msg.readUInt16BE(pos + 10);
                pos += 12;

                // Null sentinel: skip
                if (prefix === 0x0000 && recLen === 0) continue;
                // Terminator: stop
                if (prefix === 0x0004) break;
                // Validate record length
                if (recLen === 0 || pos + recLen > endPos) break;

                const recEnd = pos + recLen;

                // Record data: sourceId(2) + properties(6) + flag(1) + 6 null-terminated strings
                if (recLen < 9) { pos = recEnd; continue; } // Too short

                const sourceId = msg.readUInt16BE(pos);
                // Skip properties (6 bytes) and flag (1 byte)
                let strPos = pos + 9; // Start of first string

                // Read 6 null-terminated strings
                const strings = [];
                for (let s = 0; s < 6 && strPos < recEnd; s++) {
                    const nullIdx = msg.indexOf(0x00, strPos);
                    const end = (nullIdx >= 0 && nullIdx < recEnd) ? nullIdx : recEnd;
                    strings.push(msg.slice(strPos, end).toString('ascii'));
                    strPos = end + 1; // Skip past the null terminator
                }

                // Pad with empty strings if fewer than 6 found
                while (strings.length < 6) strings.push('');

                const entry = {
                    oled: strings[0],
                    short: strings[1],
                    eng: strings[2],
                    panel: strings[3],
                    menu: strings[4]
                };

                // Full replace for 0x020b, but preserve eng from 0x0210 if this one is empty
                const existing = this.sourceNames.get(sourceId);
                if (existing && !entry.eng && existing.eng) {
                    entry.eng = existing.eng;
                }

                this.sourceNames.set(sourceId, entry);
                namesUpdated++;

                pos = recEnd;
            }
        } catch (e) {
        }

        if (namesUpdated > 0) {
            this.emitter.emit('sourceNamesUpdated', { count: this.sourceNames.size });
        }
    }

    /**
     * Parse 0x0210 source definition response.
     * Records contain source ID + engineering name (near end of record).
     * Only merges the eng field — does not overwrite OLED/panel/menu from 0x020b.
     */
    parseSourceDefResponse(msg, pb, payLen) {
        let defsUpdated = 0;
        try {
            let pos = pb + 16;
            const endPos = pb + payLen;

            while (pos + 12 <= endPos) {
                // Record wrapper
                const prefix = msg.readUInt16BE(pos + 8);
                const recLen = msg.readUInt16BE(pos + 10);
                pos += 12;

                if (prefix === 0x0000 && recLen === 0) continue;
                if (prefix === 0x0004) break;
                if (recLen === 0 || pos + recLen > endPos) break;

                const recEnd = pos + recLen;

                if (recLen < 4) { pos = recEnd; continue; }

                const sourceId = msg.readUInt16BE(pos);

                // Engineering name: null-terminated string near the end of the record.
                // Start from the end, skip trailing nulls, then read backward to find the string start.
                let nameEnd = recEnd;
                while (nameEnd > pos + 2 && msg[nameEnd - 1] === 0x00) nameEnd--;
                let nameStart = nameEnd;
                while (nameStart > pos + 2 && msg[nameStart - 1] !== 0x00) nameStart--;

                const engName = (nameEnd > nameStart)
                    ? msg.slice(nameStart, nameEnd).toString('ascii')
                    : '';

                if (engName && sourceId > 0) {
                    const existing = this.sourceNames.get(sourceId) || { oled: '', short: '', eng: '', panel: '', menu: '' };
                    existing.eng = engName;
                    this.sourceNames.set(sourceId, existing);
                    defsUpdated++;
                }

                pos = recEnd;
            }
        } catch (e) {
        }

        if (defsUpdated > 0) {
            this.emitter.emit('sourceNamesUpdated', { count: this.sourceNames.size });
        }
    }

    /**
     * Get source name entry for a specific source number
     * @returns {{ oled: string, short: string, eng: string, panel: string, menu: string } | null}
     */
    getSourceName(sourceNum) {
        return this.sourceNames.get(sourceNum) || null;
    }

    /**
     * Get every cached source name as a detached, source-number-sorted list.
     */
    getSourceNames() {
        return Array.from(this.sourceNames.entries())
            .sort(([a], [b]) => a - b)
            .map(([id, names]) => ({ id, ...names }));
    }

    /**
     * Resolve a source number to the best display name.
     * Priority: menu > oled > panel > eng. Returns null if no name found (caller falls back to hardcoded).
     */
    resolveSourceDisplayName(sourceNum) {
        const names = this.sourceNames.get(sourceNum);
        if (names) {
            if (names.menu) return names.menu;
            if (names.oled) return names.oled;
            if (names.panel) return names.panel;
            if (names.eng) return names.eng;
        }
        return null;
    }

    /**
     * Get current source on a specific AUX bus
     */
    getAuxSource(auxNum) {
        return this.auxState.get(auxNum) || null;
    }

    /**
     * Get all AUX state as a Map copy
     */
    getAllAuxState() {
        return new Map(this.auxState);
    }

    /**
     * Check if a source is on ANY aux bus (for low tally)
     * @param {number} sourceNum - Source to search for
     * @param {number|null} excludeAux - AUX number to exclude from search
     * @returns {{ found: boolean, auxNum: number|null }}
     */
    isSourceOnAnyAux(sourceNum, excludeAux = null) {
        for (const [auxNum, src] of this.auxState) {
            if (excludeAux !== null && auxNum === excludeAux) continue;
            if (src === sourceNum) return { found: true, auxNum };
        }
        return { found: false, auxNum: null };
    }

    // ─── ME Bus Query Methods ─────────────────────────────────────────

    /**
     * Get current source on a specific ME bus
     * @param {number} address - ME address byte: (bus_code << 4) | me_num
     */
    getMESource(address) {
        return this.meState.get(address) || null;
    }

    /**
     * Get all ME state as a Map copy
     */
    getAllMEState() {
        return new Map(this.meState);
    }

    /**
     * Check if a source is on ANY ME bus (for low tally)
     * @param {number} sourceNum - Source to search for
     * @param {number|null} excludeAddress - ME address to exclude from search
     * @returns {{ found: boolean, address: number|null }}
     */
    isSourceOnAnyME(sourceNum, excludeAddress = null) {
        for (const [addr, src] of this.meState) {
            if (excludeAddress !== null && addr === excludeAddress) continue;
            if (src === sourceNum) return { found: true, address: addr };
        }
        return { found: false, address: null };
    }
}

module.exports = HandshakeConnection;
