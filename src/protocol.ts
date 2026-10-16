import protocolModule from './protocol/connection-manager.cjs'

export type CommandResult = { success: boolean; message: string }
export type ConnectionInfo = {
	connected: boolean
	fullyConnected: boolean
	protocol: string
	frameVersion: string | null
	ports: { main: number; listener: number; dynamic: number }
}
export type SourceName = { id: number; oled: string; short: string; eng: string; panel: string; menu: string }
export type MacroCatalogEntry = { oled?: string; panel?: string; comment?: string }
export type TimelineState = {
	cursorTime: number | null
	duration: number | null
	pauseState: number
	runState: number | null
	pausePoints: number[]
}
export type TransitionTelemetry = {
	ramp: number
	effectiveRate: number
	active: boolean
	direction: 'up' | 'down' | null
}

export type ProtocolManager = {
	createConnection(
		id: string,
		host: string,
		suite: string,
		ports: { mainPort: number; listenerPort: number },
		suiteName: string,
		version: string,
		buildDate: string,
	): Promise<() => void>
	disconnectConnection(id: string): Promise<void>
	getConnectionInfo(id: string): ConnectionInfo | null
	getMacroName(id: string, macro: number): string | null
	getMacroCatalog(id: string): Record<number, MacroCatalogEntry> | null
	getMacroStatus(id: string, macro: number): number | null
	getMacroRunState(
		id: string,
	): { macroStatus: Record<number, number>; lastPlayedMacro: number | null; runSeq: number } | null
	resolveSourceDisplayName(id: string, source: number): string | null
	getSourceNames(id: string): SourceName[]
	getAuxSource(id: string, aux: number): number | null
	getMESource(id: string, address: number): number | null
	getKeyerSource(id: string, address: number): number | null
	getTimelineState(id: string): TimelineState | null
	getImageStoreImage(id: string, output: number): number | null
	getTransitionTelemetry(id: string, did: number): TransitionTelemetry | null
	sendMacro(id: string, macro: number): CommandResult
	sendMacroStop(id: string, macro: number): CommandResult
	sendMacroStopAll(id: string): CommandResult
	sendAuxRoute(id: string, aux: number, source: number, transition: string): CommandResult
	sendEMem(id: string, register: number): CommandResult
	sendEMemTargeted(id: string, register: number, did: number, mode: number): CommandResult
	sendCrosspoint(id: string, pid: number, did: number, source: number): CommandResult
	sendTransitionEvent(id: string, eid: number, did: number): CommandResult
	sendTimelineEvent(id: string, eid: number, did: number, data: number[]): CommandResult
	sendPanelMem(id: string, register: number): CommandResult
	sendImageStore(id: string, output: number, image: number): CommandResult
	sendImageStoreInput(id: string, input: number): CommandResult
	sendRawCommand(id: string, command: string): CommandResult
	subscribeToAuxBus(id: string): CommandResult
	subscribeToMEBus(id: string): CommandResult
	subscribeToSourceNames(id: string): CommandResult
	subscribeToMasterTimeline(id: string): CommandResult
	subscribeToImageStore(id: string): CommandResult
	subscribeToTransitionTelemetry(id: string): CommandResult
	clientEmitter: NodeJS.EventEmitter
}

export const protocol: ProtocolManager = protocolModule
