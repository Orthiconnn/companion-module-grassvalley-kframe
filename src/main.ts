import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, maximumRetries, suiteEnabled, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { protocol, type CommandResult } from './protocol.js'
import type { DropdownChoice } from '@companion-module/base'

export const SUITES = ['suite1a', 'suite2a', 'suite3a', 'suite4a'] as const
export type SuiteId = (typeof SUITES)[number]
export type SuiteState = {
	status: string
	connectionPhase?: 'establishing' | 'handshake'
	frameVersion: string
	protocolName: string
	heartbeatFlash: boolean
	timer?: NodeJS.Timeout
}

export function suiteId(value: unknown): SuiteId {
	return SUITES.includes(value as SuiteId) ? (value as SuiteId) : 'suite1a'
}
export function suiteNumber(id: SuiteId): number {
	return Number(id[5])
}
export function suitePorts(id: SuiteId): [number, number] {
	// Required fixed UDP ports: Suites 1–4 use 6132/6133 through 6138/6139.
	// Maintainer confirmed 2026-10-14: conflicts with another local port owner
	// are understood and accepted. Do not change or auto-select these ports.
	// See README "Required UDP ports"; error handling and cleanup are separate concerns.
	const main = 6130 + suiteNumber(id) * 2
	return [main, main + 1]
}
export function textScale(value: unknown): number {
	const percent = Number(value)
	return Math.max(0.5, Math.min(2, Number.isFinite(percent) ? percent / 100 : 1))
}

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

// Feedback displays the most recently subscribed action of each type. Keep all
// action instances so removing one restores the remaining assignment instead of
// clearing the whole button. Companion action IDs are unique within a control.
class ButtonAssignments<T> extends Map<string, T> {
	private readonly assignments = new Map<string, Map<string, T>>()

	setAction(controlId: string, actionId: string, value: T): void {
		const actions = this.assignments.get(controlId) ?? new Map<string, T>()
		actions.delete(actionId)
		actions.set(actionId, value)
		this.assignments.set(controlId, actions)
		this.set(controlId, value)
	}

	deleteAction(controlId: string, actionId: string): void {
		const actions = this.assignments.get(controlId)
		if (!actions?.delete(actionId)) return
		if (actions.size === 0) {
			this.assignments.delete(controlId)
			this.delete(controlId)
		} else {
			this.set(controlId, [...actions.values()][actions.size - 1])
		}
	}
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	readonly suiteStates = Object.fromEntries(
		SUITES.map((id) => [id, { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }]),
	) as Record<SuiteId, SuiteState>
	readonly macroButtons = new ButtonAssignments<{
		suite: SuiteId
		macro: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly auxButtons = new ButtonAssignments<{
		suite: SuiteId
		aux: number
		source: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly crosspointButtons = new ButtonAssignments<{
		suite: SuiteId
		target: string
		source: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly imageStoreButtons = new ButtonAssignments<{
		suite: SuiteId
		output: number
		image: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly panelMemoryButtons = new ButtonAssignments<{
		suite: SuiteId
		register: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly gpiButtons = new ButtonAssignments<{
		suite: SuiteId
		gpi: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly ememButtons = new ButtonAssignments<{
		suite: SuiteId
		target: string
		register: number
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly transitionButtons = new ButtonAssignments<{
		suite: SuiteId
		target: string
		transition: string
		labelOverride: string
		textSize: number
		showSuite: boolean
	}>()
	readonly suiteButtons = new Map<string, Map<string, { suite: SuiteId; textSize: number; showSuite: boolean }>>()
	private sourceRefreshTimer?: NodeJS.Timeout
	private macroCatalogRefreshTimer?: NodeJS.Timeout
	private macroFlashTimer?: NodeJS.Timeout
	private timelineRefreshTimer?: NodeJS.Timeout
	private transitionRefreshTimer?: NodeJS.Timeout
	private timelinePulseTimer?: NodeJS.Timeout
	private reportedStatus?: InstanceStatus
	private automaticConnectChain: Promise<void> = Promise.resolve()
	private readonly manuallyDisconnectedSuites = new Set<SuiteId>()
	private readonly automaticConnectInProgress = new Set<SuiteId>()
	private readonly automaticConnectQueued = new Set<SuiteId>()
	private connectionConfigGeneration = 0
	private shuttingDown = false
	private readonly frameMacroStates = new Map<string, Map<number, number>>()
	private readonly frameLastPlayedMacros = new Map<string, number>()
	private readonly frameTimelineStates = new Map<string, string>()
	private readonly frameTransitionStates = new Map<string, boolean>()
	private readonly frameImageStoreStates = new Map<string, number>()
	macroFlashOn = false
	timelinePulsePhase = 0

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		protocol.initialize(null)
		protocol.clientEmitter.on('status', this.handleProtocolStatus)
		protocol.clientEmitter.on('sourceNamesUpdated', this.handleSourceNamesUpdated)
		protocol.clientEmitter.on('auxStateChanged', this.handleAuxStateChanged)
		protocol.clientEmitter.on('meStateChanged', this.handleMEStateChanged)
		protocol.clientEmitter.on('timelineStateChanged', this.handleTimelineStateChanged)
		protocol.clientEmitter.on('imageStoreStateChanged', this.handleImageStoreStateChanged)
		protocol.clientEmitter.on('transitionTelemetryChanged', this.handleTransitionTelemetryChanged)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updatePresets() // export Presets
		this.updateVariableDefinitions() // export variable definitions
		this.updateRuntimeState()
		this.queueSelectedSuiteCascade()
		this.macroFlashTimer = setInterval(() => {
			this.macroFlashOn = !this.macroFlashOn
			this.checkFeedbacks('macro_button_state')
		}, 500)
		this.timelinePulseTimer = setInterval(() => {
			const paused = SUITES.some((suite) => (protocol.getTimelineState(this.connectionId(suite))?.pauseState ?? 0) > 0)
			if (!paused) return
			this.timelinePulsePhase = (this.timelinePulsePhase + 1) % 16
			this.checkFeedbacks('timeline_progress')
		}, 100)
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		this.shuttingDown = true
		this.connectionConfigGeneration++
		this.manuallyDisconnectedSuites.clear()
		for (const id of SUITES)
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		this.checkFeedbacks('connection_state')
		this.updateRuntimeState()
		for (const state of Object.values(this.suiteStates)) if (state.timer) clearTimeout(state.timer)
		if (this.sourceRefreshTimer) clearTimeout(this.sourceRefreshTimer)
		if (this.macroCatalogRefreshTimer) clearTimeout(this.macroCatalogRefreshTimer)
		if (this.macroFlashTimer) clearInterval(this.macroFlashTimer)
		if (this.timelineRefreshTimer) clearTimeout(this.timelineRefreshTimer)
		if (this.transitionRefreshTimer) clearTimeout(this.transitionRefreshTimer)
		if (this.timelinePulseTimer) clearInterval(this.timelinePulseTimer)
		protocol.clientEmitter.off('status', this.handleProtocolStatus)
		protocol.clientEmitter.off('sourceNamesUpdated', this.handleSourceNamesUpdated)
		protocol.clientEmitter.off('auxStateChanged', this.handleAuxStateChanged)
		protocol.clientEmitter.off('meStateChanged', this.handleMEStateChanged)
		protocol.clientEmitter.off('timelineStateChanged', this.handleTimelineStateChanged)
		protocol.clientEmitter.off('imageStoreStateChanged', this.handleImageStoreStateChanged)
		protocol.clientEmitter.off('transitionTelemetryChanged', this.handleTransitionTelemetryChanged)
		await Promise.all(SUITES.map(async (id) => protocol.disconnectConnection(this.connectionId(id))))
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.shuttingDown = true
		this.connectionConfigGeneration++
		this.config = config
		this.manuallyDisconnectedSuites.clear()
		if (this.sourceRefreshTimer) {
			clearTimeout(this.sourceRefreshTimer)
			this.sourceRefreshTimer = undefined
		}
		if (this.macroCatalogRefreshTimer) {
			clearTimeout(this.macroCatalogRefreshTimer)
			this.macroCatalogRefreshTimer = undefined
		}
		if (this.timelineRefreshTimer) {
			clearTimeout(this.timelineRefreshTimer)
			this.timelineRefreshTimer = undefined
		}
		if (this.transitionRefreshTimer) {
			clearTimeout(this.transitionRefreshTimer)
			this.transitionRefreshTimer = undefined
		}
		await Promise.all(SUITES.map(async (id) => protocol.disconnectConnection(this.connectionId(id))))
		for (const id of SUITES)
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		this.shuttingDown = false
		this.updateActions()
		this.updatePresets()
		this.updateRuntimeState()
		this.queueSelectedSuiteCascade()
	}

	private handleSourceNamesUpdated = (connectionId: string): void => {
		if (!SUITES.some((suite) => this.connectionId(suite) === connectionId)) return
		if (this.sourceRefreshTimer) clearTimeout(this.sourceRefreshTimer)
		this.sourceRefreshTimer = setTimeout(() => {
			this.sourceRefreshTimer = undefined
			this.updateActions()
			this.updatePresets()
			this.checkFeedbacks('aux_button_state', 'crosspoint_button_state')
		}, 100)
	}

	private frameSuite(connectionId: string): SuiteId | undefined {
		return SUITES.find((suite) => this.connectionId(suite) === connectionId)
	}

	private frameSource(connectionId: string, source: number): string {
		const name = protocol.resolveSourceDisplayName(connectionId, source)
		return name ? `${name} (${source})` : `Source ${source}`
	}

	private frameLog(connectionId: string, message: string): void {
		const suite = this.frameSuite(connectionId)
		if (suite) this.log('info', `FRAME Suite ${suiteNumber(suite)}: ${message}`)
	}

	private clearFrameLogState(connectionId: string): void {
		this.frameMacroStates.delete(connectionId)
		this.frameLastPlayedMacros.delete(connectionId)
		this.frameTimelineStates.delete(connectionId)
		for (const key of this.frameTransitionStates.keys())
			if (key.startsWith(`${connectionId}:`)) this.frameTransitionStates.delete(key)
		for (const key of this.frameImageStoreStates.keys())
			if (key.startsWith(`${connectionId}:`)) this.frameImageStoreStates.delete(key)
	}

	private handleAuxStateChanged = (connectionId: string, data: unknown): void => {
		if (!this.frameSuite(connectionId)) return
		this.checkFeedbacks('aux_button_state')
		if (data && typeof data === 'object' && 'origin' in data && data.origin === 'frame') {
			const aux = Number('auxNum' in data ? data.auxNum : NaN)
			const source = Number('currentSource' in data ? data.currentSource : NaN)
			const previous = 'previousSource' in data ? data.previousSource : null
			if (Number.isFinite(aux) && Number.isFinite(source) && previous !== null && previous !== undefined)
				this.frameLog(connectionId, `AUX ${aux} changed to ${this.frameSource(connectionId, source)}`)
		}
	}

	private handleMEStateChanged = (connectionId: string, data: unknown): void => {
		if (!this.frameSuite(connectionId)) return
		this.checkFeedbacks('crosspoint_button_state')
		if (data && typeof data === 'object' && 'origin' in data && data.origin === 'frame') {
			const address = Number('address' in data ? data.address : NaN)
			const source = Number('currentSource' in data ? data.currentSource : NaN)
			const previous = 'previousSource' in data ? data.previousSource : null
			if (Number.isFinite(address) && Number.isFinite(source) && previous !== null && previous !== undefined)
				this.frameLog(
					connectionId,
					`${'kind' in data && data.kind === 'keyer' ? 'Keyer' : 'Crosspoint'} address 0x${address.toString(16).padStart(2, '0')} changed to ${this.frameSource(connectionId, source)}`,
				)
		}
	}

	private handleTimelineStateChanged = (connectionId: string, data: unknown): void => {
		if (!this.frameSuite(connectionId)) return
		if (data && typeof data === 'object' && 'origin' in data && data.origin === 'frame') {
			const run = Number('runState' in data ? data.runState : 0)
			const pause = Number('pauseState' in data ? data.pauseState : 0)
			const signature = `${run}:${pause}`
			const previous = this.frameTimelineStates.get(connectionId)
			if (previous !== signature) {
				this.frameTimelineStates.set(connectionId, signature)
				if (previous !== undefined)
					this.frameLog(
						connectionId,
						pause > 0 ? 'Master timeline paused' : run > 0 ? 'Master timeline running' : 'Master timeline stopped',
					)
			}
		}
		if (this.timelineRefreshTimer) return
		this.timelineRefreshTimer = setTimeout(() => {
			this.timelineRefreshTimer = undefined
			this.checkFeedbacks('timeline_progress')
		}, 100)
	}

	private handleImageStoreStateChanged = (connectionId: string, data: unknown): void => {
		if (!this.frameSuite(connectionId)) return
		this.checkFeedbacks('image_store_button_state')
		if (data && typeof data === 'object' && 'origin' in data && data.origin === 'frame') {
			const output = Number('output' in data ? data.output : NaN)
			const image = Number('image' in data ? data.image : NaN)
			if (Number.isFinite(output) && Number.isFinite(image)) {
				const key = `${connectionId}:${output}`
				if (this.frameImageStoreStates.has(key))
					this.frameLog(connectionId, `Image Store output ${output} changed to image ${String(image).padStart(4, '0')}`)
				this.frameImageStoreStates.set(key, image)
			}
		}
	}

	private handleTransitionTelemetryChanged = (connectionId: string, data: unknown): void => {
		if (!this.frameSuite(connectionId)) return
		if (data && typeof data === 'object' && 'origin' in data && data.origin === 'frame') {
			const did = Number('did' in data ? data.did : NaN)
			const active = Boolean('active' in data && data.active)
			const key = `${connectionId}:${did}`
			const previous = this.frameTransitionStates.get(key)
			if (Number.isFinite(did) && previous !== active) {
				this.frameTransitionStates.set(key, active)
				if (previous !== undefined || active) {
					const direction = 'direction' in data && typeof data.direction === 'string' ? ` ${data.direction}` : ''
					this.frameLog(
						connectionId,
						`Transition 0x${did.toString(16)} ${active ? `started${direction}` : 'completed'}`,
					)
				}
			}
		}
		if (this.transitionRefreshTimer) return
		this.transitionRefreshTimer = setTimeout(() => {
			this.transitionRefreshTimer = undefined
			this.checkFeedbacks('transition_button_state')
		}, 100)
	}

	private handleProtocolStatus = (connectionId: string, type: string, message: unknown): void => {
		const id = SUITES.find((suite) => this.connectionId(suite) === connectionId)
		if (!id) return
		const state = this.suiteStates[id]
		if (type === 'CONNECTED') {
			state.status = 'connected'
			state.connectionPhase = undefined
			const protocolId = this.connectionId(id)
			const info = protocol.getConnectionInfo(protocolId)
			state.frameVersion = info?.frameVersion ?? ''
			state.protocolName = info?.protocol?.toUpperCase() ?? ''
			protocol.subscribeToSourceNames(protocolId)
			setTimeout(() => protocol.subscribeToAuxBus(protocolId), 200)
			setTimeout(() => protocol.subscribeToMEBus(protocolId), 400)
			setTimeout(() => protocol.subscribeToMasterTimeline(protocolId), 600)
			setTimeout(() => protocol.subscribeToImageStore(protocolId), 800)
			setTimeout(() => protocol.subscribeToTransitionTelemetry(protocolId), 1000)
			this.frameLog(connectionId, 'Connection established')
		} else if (type === 'HEARTBEAT_ACK') {
			state.heartbeatFlash = true
			this.checkFeedbacks('connection_state')
			if (state.timer) clearTimeout(state.timer)
			state.timer = setTimeout(() => {
				state.heartbeatFlash = false
				this.checkFeedbacks('connection_state')
			}, 300)
		} else if (type === 'MACRO_CATALOG_READY') {
			this.updateActions()
			this.updatePresets()
			this.checkFeedbacks('macro_button_state')
			// Companion can have an action editor open while the bulk catalog is
			// settling. Publish the completed choices once more on the next turn so
			// the editor receives the final named list, not its initial fallback.
			if (this.macroCatalogRefreshTimer) clearTimeout(this.macroCatalogRefreshTimer)
			this.macroCatalogRefreshTimer = setTimeout(() => {
				this.macroCatalogRefreshTimer = undefined
				this.updateActions()
			}, 250)
			const count = Object.keys(protocol.getMacroCatalog(connectionId) ?? {}).length
			this.frameLog(connectionId, `Macro catalog received (${count} entries)`)
		} else if (
			type === 'MACRO_STATUS_CHANGED' &&
			message &&
			typeof message === 'object' &&
			'origin' in message &&
			message.origin === 'frame' &&
			'macroStatus' in message &&
			message.macroStatus &&
			typeof message.macroStatus === 'object'
		) {
			const hasBaseline = this.frameMacroStates.has(connectionId)
			const previous = this.frameMacroStates.get(connectionId) ?? new Map<number, number>()
			const current = new Map<number, number>()
			for (const [macroText, statusValue] of Object.entries(message.macroStatus)) {
				const macro = Number(macroText)
				const status = Number(statusValue)
				if (Number.isFinite(macro) && Number.isFinite(status)) current.set(macro, status)
			}
			for (const [macro, status] of current) {
				if (!hasBaseline) continue
				if (previous.get(macro) === status) continue
				const name = protocol.getMacroName(connectionId, macro)
				this.frameLog(connectionId, `Macro ${macro}${name ? ` “${name}”` : ''} ${status === 7 ? 'paused' : 'playing'}`)
			}
			for (const macro of previous.keys()) {
				if (!hasBaseline) continue
				if (!current.has(macro)) {
					const name = protocol.getMacroName(connectionId, macro)
					this.frameLog(connectionId, `Macro ${macro}${name ? ` “${name}”` : ''} stopped`)
				}
			}
			this.frameMacroStates.set(connectionId, current)
			if ('lastPlayedMacro' in message) {
				const macro = Number(message.lastPlayedMacro)
				if (Number.isFinite(macro) && macro > 0 && this.frameLastPlayedMacros.get(connectionId) !== macro) {
					this.frameLastPlayedMacros.set(connectionId, macro)
					if (hasBaseline && !current.has(macro)) {
						const name = protocol.getMacroName(connectionId, macro)
						this.frameLog(connectionId, `Macro ${macro}${name ? ` “${name}”` : ''} played`)
					}
				}
			}
		} else if (type === 'FRAME_VERSION' && message && typeof message === 'object' && 'version' in message) {
			state.frameVersion = String(message.version)
			this.frameLog(connectionId, `Frame version ${state.frameVersion}`)
		} else if (type === 'SUB_PARSE_ERROR') {
			this.log('warn', `FRAME Suite ${suiteNumber(id)}: subscription parse error: ${String(message)}`)
		} else if (['ERROR', 'DISCONNECTED', 'HANDSHAKE_TIMEOUT_ERROR', 'HEARTBEAT_TIMEOUT'].includes(type)) {
			state.status = 'disconnected'
			// Disconnect can be announced before protocol cleanup clears the catalog.
			// Reuse the deferred definitions refresh so remaining suites supply labels.
			if (type === 'DISCONNECTED' && !this.shuttingDown) this.handleSourceNamesUpdated(connectionId)
			const detail = typeof message === 'string' ? message : type
			this.log('warn', `Suite ${suiteNumber(id)}: ${detail}`)
			if (
				!this.shuttingDown &&
				!this.automaticConnectInProgress.has(id) &&
				!this.manuallyDisconnectedSuites.has(id) &&
				this.isSuiteSelected(id)
			)
				this.queueAutomaticConnect(id)
		} else if (type === 'CONNECTING' || type === 'HANDSHAKE_COMPLETE') {
			state.status = 'connecting'
			const detail = String(message).toLowerCase()
			state.connectionPhase =
				type === 'HANDSHAKE_COMPLETE' || /handshake|auth|registration/.test(detail) ? 'handshake' : 'establishing'
		}
		this.updateRuntimeState()
	}

	async connectSuite(value: unknown, automatic = false, automaticGeneration?: number): Promise<boolean> {
		const id = suiteId(value)
		const state = this.suiteStates[id]
		if (!automatic) this.manuallyDisconnectedSuites.delete(id)
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Target IP is required')
			return false
		}
		if (state.status === 'connected' || state.status === 'connecting') return true
		state.status = 'connecting'
		state.connectionPhase = 'establishing'
		this.clearFrameLogState(this.connectionId(id))
		this.updateRuntimeState()
		try {
			if (automatic) this.automaticConnectInProgress.add(id)
			const [mainPort, listenerPort] = suitePorts(id)
			await protocol.createConnection(
				this.connectionId(id),
				this.config.host,
				id,
				{ mainPort, listenerPort },
				`Suite ${suiteNumber(id)}`,
				'2026.0.9.2',
				'Oct 14 2026',
			)
			if (
				this.shuttingDown ||
				this.manuallyDisconnectedSuites.has(id) ||
				(automaticGeneration !== undefined && automaticGeneration !== this.connectionConfigGeneration)
			) {
				await protocol.disconnectConnection(this.connectionId(id))
				state.status = 'disconnected'
				this.updateRuntimeState()
				return false
			}
			const connected = await this.waitForSuiteConnection(id, 20000)
			if (!connected && state.status !== 'disconnected') {
				await protocol.disconnectConnection(this.connectionId(id))
				state.status = 'disconnected'
				this.updateRuntimeState()
			}
			return connected
		} catch (error) {
			state.status = 'disconnected'
			this.log('warn', `Suite ${suiteNumber(id)}: ${String(error)}`)
			this.updateRuntimeState()
			return false
		} finally {
			this.automaticConnectInProgress.delete(id)
		}
	}

	private async waitForSuiteConnection(id: SuiteId, timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			if (this.suiteStates[id].status === 'connected') return true
			if (this.suiteStates[id].status === 'disconnected') return false
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		return false
	}

	async disconnectSuite(value: unknown): Promise<void> {
		const id = suiteId(value)
		this.manuallyDisconnectedSuites.add(id)
		await protocol.disconnectConnection(this.connectionId(id))
		this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		if (!this.shuttingDown) this.handleSourceNamesUpdated(this.connectionId(id))
		this.updateRuntimeState()
	}

	private isSuiteSelected(id: SuiteId): boolean {
		return suiteEnabled(this.config, suiteNumber(id))
	}

	private queueSelectedSuiteCascade(): void {
		const selected = SUITES.filter((id) => this.isSuiteSelected(id))
		const generation = this.connectionConfigGeneration
		this.automaticConnectChain = this.automaticConnectChain.then(async () => {
			for (const id of selected) {
				if (generation !== this.connectionConfigGeneration) return
				if (this.shuttingDown || !this.isSuiteSelected(id) || this.manuallyDisconnectedSuites.has(id)) continue
				await this.connectAutomaticallyWithRetries(id, generation)
			}
		})
	}

	private queueAutomaticConnect(id: SuiteId): void {
		if (this.automaticConnectQueued.has(id)) return
		this.automaticConnectQueued.add(id)
		const generation = this.connectionConfigGeneration
		this.automaticConnectChain = this.automaticConnectChain.then(async () => {
			try {
				if (
					generation !== this.connectionConfigGeneration ||
					this.shuttingDown ||
					!this.isSuiteSelected(id) ||
					this.manuallyDisconnectedSuites.has(id)
				)
					return
				await this.connectAutomaticallyWithRetries(id, generation)
			} finally {
				this.automaticConnectQueued.delete(id)
			}
		})
	}

	private async connectAutomaticallyWithRetries(id: SuiteId, generation: number): Promise<void> {
		const retries = maximumRetries(this.config)
		for (let attempt = 0; attempt <= retries; attempt++) {
			if (
				generation !== this.connectionConfigGeneration ||
				this.shuttingDown ||
				!this.isSuiteSelected(id) ||
				this.manuallyDisconnectedSuites.has(id)
			)
				return
			if (await this.connectSuite(id, true, generation)) return
			if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 2000))
		}
		this.log('warn', `Suite ${suiteNumber(id)}: maximum reconnection attempts reached`)
	}

	send(command: () => CommandResult): void {
		const result = command()
		if (!result.success) this.log('warn', result.message)
	}

	trackMacroButton(
		controlId: string,
		suite: unknown,
		macro: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'macro_play',
	): void {
		const targetSuite = suiteId(suite)
		this.macroButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			macro: Number(macro) || 1,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('macro_button_state')
	}

	untrackMacroButton(controlId: string, actionId: string = 'macro_play'): void {
		this.macroButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('macro_button_state')
	}

	trackAuxButton(
		controlId: string,
		suite: unknown,
		aux: unknown,
		source: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'aux_route',
	): void {
		const targetSuite = suiteId(suite)
		this.auxButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			aux: Number(aux) || 1,
			source: Number(source) || 1,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('aux_button_state')
	}

	trackCrosspointButton(
		controlId: string,
		suite: unknown,
		target: unknown,
		source: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'crosspoint',
	): void {
		const targetSuite = suiteId(suite)
		this.crosspointButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			target: String(target),
			source: Number(source) || 1,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('crosspoint_button_state')
	}

	untrackCrosspointButton(controlId: string, actionId: string = 'crosspoint'): void {
		this.crosspointButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('crosspoint_button_state')
	}

	untrackAuxButton(controlId: string, actionId: string = 'aux_route'): void {
		this.auxButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('aux_button_state')
	}

	trackImageStoreButton(
		controlId: string,
		suite: unknown,
		output: unknown,
		image: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'image_store',
	): void {
		const targetSuite = suiteId(suite)
		this.imageStoreButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			output: Number(output) || 1,
			image: Number(image) || 1,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('image_store_button_state')
	}

	untrackImageStoreButton(controlId: string, actionId: string = 'image_store'): void {
		this.imageStoreButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('image_store_button_state')
	}

	trackPanelMemoryButton(
		controlId: string,
		suite: unknown,
		register: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'panel_memory',
	): void {
		const targetSuite = suiteId(suite)
		this.panelMemoryButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			register: Number(register) || 1,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('panel_memory_button_state')
	}

	untrackPanelMemoryButton(controlId: string, actionId: string = 'panel_memory'): void {
		this.panelMemoryButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('panel_memory_button_state')
	}

	trackGpiButton(
		controlId: string,
		suite: unknown,
		gpi: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'gpi',
	): void {
		const targetSuite = suiteId(suite)
		this.gpiButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			gpi: Number(gpi) || 1,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('gpi_button_state')
	}

	untrackGpiButton(controlId: string, actionId: string = 'gpi'): void {
		this.gpiButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('gpi_button_state')
	}

	trackTransitionButton(
		controlId: string,
		suite: unknown,
		target: unknown,
		transition: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'transition',
	): void {
		const targetSuite = suiteId(suite)
		this.transitionButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			target: String(target),
			transition: String(transition),
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('transition_button_state')
	}

	untrackTransitionButton(controlId: string, actionId: string = 'transition'): void {
		this.transitionButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('transition_button_state')
	}

	trackEmemButton(
		controlId: string,
		suite: unknown,
		target: unknown,
		register: unknown,
		labelOverride: unknown = '',
		textSize: unknown = 100,
		showSuite: unknown = true,
		actionId: string = 'emem',
	): void {
		const targetSuite = suiteId(suite)
		this.ememButtons.setAction(controlId, actionId, {
			suite: targetSuite,
			target: String(target),
			register: Number(register) || 0,
			labelOverride: typeof labelOverride === 'string' ? labelOverride.trim() : '',
			textSize: textScale(textSize),
			showSuite: showSuite !== false,
		})
		this.trackSuiteButton(controlId, actionId, targetSuite, textSize, showSuite)
		this.checkFeedbacks('emem_button_state')
	}

	untrackEmemButton(controlId: string, actionId: string = 'emem'): void {
		this.ememButtons.deleteAction(controlId, actionId)
		this.untrackSuiteButton(controlId, actionId)
		this.checkFeedbacks('emem_button_state')
	}

	trackSuiteButton(
		controlId: string,
		actionId: string,
		suite: unknown,
		textSize: unknown = 100,
		showSuite: unknown = true,
	): void {
		const actions =
			this.suiteButtons.get(controlId) ?? new Map<string, { suite: SuiteId; textSize: number; showSuite: boolean }>()
		actions.set(actionId, { suite: suiteId(suite), textSize: textScale(textSize), showSuite: showSuite !== false })
		this.suiteButtons.set(controlId, actions)
		this.checkFeedbacks('suite_badge')
	}

	showSuiteDot(controlId: string, actionType: string): boolean {
		const assignments: Record<string, Map<string, { showSuite: boolean }>> = {
			macro_play: this.macroButtons,
			aux_route: this.auxButtons,
			crosspoint: this.crosspointButtons,
			image_store: this.imageStoreButtons,
			panel_memory: this.panelMemoryButtons,
			gpi: this.gpiButtons,
			transition: this.transitionButtons,
			emem: this.ememButtons,
		}
		return assignments[actionType]?.get(controlId)?.showSuite !== false
	}

	untrackSuiteButton(controlId: string, actionId: string): void {
		const actions = this.suiteButtons.get(controlId)
		if (actions) {
			actions.delete(actionId)
			if (actions.size === 0) this.suiteButtons.delete(controlId)
		}
		this.checkFeedbacks('suite_badge')
	}

	private updateRuntimeState(): void {
		const statuses = Object.values(this.suiteStates).map((state) => state.status)
		const status = statuses.includes('connected')
			? InstanceStatus.Ok
			: statuses.includes('connecting')
				? InstanceStatus.Connecting
				: InstanceStatus.Disconnected
		if (status !== this.reportedStatus) {
			this.reportedStatus = status
			this.updateStatus(
				status,
				status === InstanceStatus.Ok
					? 'Suite connected'
					: status === InstanceStatus.Connecting
						? 'Connecting to suite'
						: 'No suites connected',
			)
		}
		this.setVariableValues(
			Object.fromEntries(
				SUITES.flatMap((id) => {
					const n = suiteNumber(id),
						state = this.suiteStates[id]
					return [
						[`suite${n}_connection_status`, state.status],
						[`suite${n}_protocol`, state.protocolName],
						[`suite${n}_frame_version`, state.frameVersion],
					]
				}),
			),
		)
		this.checkFeedbacks(
			'connected',
			'connection_state',
			'macro_active',
			'macro_button_state',
			'aux_button_state',
			'crosspoint_button_state',
			'image_store_button_state',
			'panel_memory_button_state',
			'gpi_button_state',
			'transition_button_state',
			'emem_button_state',
			'timeline_progress',
		)
	}

	get protocol(): typeof protocol {
		return protocol
	}

	connectionId(id: SuiteId): string {
		return `${this.id}:${id}`
	}

	sourceChoices(maximum: number): DropdownChoice<number>[] {
		const liveNames = new Map<number, string>()
		// Action definitions are module-wide, so the lowest-numbered connected suite
		// deterministically supplies the label when suites disagree about a source name.
		for (const suite of SUITES) {
			for (const source of protocol.getSourceNames(this.connectionId(suite))) {
				if (source.id < 1 || source.id > maximum || liveNames.has(source.id)) continue
				const name = source.menu || source.oled || source.panel || source.eng || source.short
				if (name) liveNames.set(source.id, name)
			}
		}
		// Keep every valid source selectable while disconnected. Live frame names
		// replace these deterministic fallbacks as soon as the catalog arrives.
		return Array.from({ length: maximum }, (_, index) => {
			const id = index + 1
			const name = liveNames.get(id)
			return { id, label: name ? `${id} — ${name}` : `Source ${id}` }
		})
	}

	sourceDisplayName(source: number): string {
		for (const suite of SUITES) {
			const name = protocol.resolveSourceDisplayName(this.connectionId(suite), source)
			if (name) return name
		}
		return String(source)
	}

	macroChoices(): DropdownChoice<number>[] {
		const liveNames = new Map<number, string>()
		for (const suite of SUITES) {
			const catalog = protocol.getMacroCatalog(this.connectionId(suite)) ?? {}
			for (const [rawNumber, entry] of Object.entries(catalog)) {
				const macro = Number(rawNumber)
				if (macro < 1 || macro > 999 || liveNames.has(macro)) continue
				const name = entry.oled || entry.panel || entry.comment
				if (name) liveNames.set(macro, name)
			}
		}
		return Array.from({ length: 999 }, (_, index) => {
			const id = index + 1
			const name = liveNames.get(id)
			return { id, label: name ? `${id} — ${name}` : `Macro ${id}` }
		})
	}

	macroDisplayName(suite: SuiteId, macro: number): string {
		return protocol.getMacroName(this.connectionId(suite), macro) || `Macro ${macro}`
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}
