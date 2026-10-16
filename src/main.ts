import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, maximumRetries, suiteEnabled, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { protocol, type CommandResult } from './protocol.js'
import { MODULE_BUILD_DATE, MODULE_VERSION } from './version.js'
import type { DropdownChoice } from '@companion-module/base'

export const SUITES = ['suite1a', 'suite2a', 'suite3a', 'suite4a'] as const
const FAST_RETRY_MS = 2000
const SLOW_RETRY_MS = 30000
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

// The action with the lowest ID wins, so a button shows the same assignment
// regardless of Companion's subscription order. Companion action IDs are
// persistent and unique within a control.
export function primaryAction<T>(actions: Map<string, T> | undefined): T | undefined {
	if (!actions || actions.size === 0) return undefined
	let winner: string | undefined
	for (const actionId of actions.keys()) if (winner === undefined || actionId < winner) winner = actionId
	return actions.get(winner as string)
}

export type SuiteButton = { suite: SuiteId; textSize: number; showSuite: boolean }
export type ButtonStyle = SuiteButton & { labelOverride: string }
export type ButtonAction = {
	id: string
	controlId: string
	options: { suite?: unknown; labelOverride?: unknown; textSize?: unknown; showSuite?: unknown }
}

// The suite, label override, text size and suite dot every labelled action shares.
export function buttonStyle(options: ButtonAction['options']): ButtonStyle {
	return {
		suite: suiteId(options.suite),
		labelOverride: typeof options.labelOverride === 'string' ? options.labelOverride.trim() : '',
		textSize: textScale(options.textSize),
		showSuite: options.showSuite !== false,
	}
}

// Keep all action instances so removing one restores the remaining assignment
// instead of clearing the whole button.
export class ButtonAssignments<T> extends Map<string, ButtonStyle & T> {
	private readonly assignments = new Map<string, Map<string, ButtonStyle & T>>()

	constructor(readonly feedbackId: keyof FeedbacksSchema) {
		super()
	}

	setAction(controlId: string, actionId: string, value: ButtonStyle & T): void {
		const actions = this.assignments.get(controlId) ?? new Map<string, ButtonStyle & T>()
		actions.set(actionId, value)
		this.assignments.set(controlId, actions)
		this.set(controlId, primaryAction(actions) as ButtonStyle & T)
	}

	deleteAction(controlId: string, actionId: string): void {
		const actions = this.assignments.get(controlId)
		if (!actions?.delete(actionId)) return
		if (actions.size === 0) {
			this.assignments.delete(controlId)
			this.delete(controlId)
		} else {
			this.set(controlId, primaryAction(actions) as ButtonStyle & T)
		}
	}
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	readonly suiteStates = Object.fromEntries(
		SUITES.map((id) => [id, { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }]),
	) as Record<SuiteId, SuiteState>
	readonly macroButtons = new ButtonAssignments<{ macro: number }>('macro_button_state')
	readonly auxButtons = new ButtonAssignments<{ aux: number; source: number }>('aux_button_state')
	readonly crosspointButtons = new ButtonAssignments<{ target: string; source: number }>('crosspoint_button_state')
	readonly imageStoreButtons = new ButtonAssignments<{ output: number; image: number }>('image_store_button_state')
	readonly imageStoreInputButtons = new ButtonAssignments<{ source: number }>('image_store_input_state')
	readonly actionLabelButtons = new ButtonAssignments<{
		kind: 'macro_stop' | 'run' | 'timeline_edit'
		macro: number
		target: string
		command: string
	}>('action_label')
	readonly panelMemoryButtons = new ButtonAssignments<{ register: number }>('panel_memory_button_state')
	readonly gpiButtons = new ButtonAssignments<{ gpi: number }>('gpi_button_state')
	readonly pbusButtons = new ButtonAssignments<{ pbus: number; command: 'recall' | 'trigger'; value: number }>(
		'pbus_button_state',
	)
	readonly mappingButtons = new ButtonAssignments<{ bus: string; shift: number; button: number; source: number }>(
		'button_mapping_state',
	)
	readonly ememButtons = new ButtonAssignments<{ target: string; register: number }>('emem_button_state')
	readonly transitionButtons = new ButtonAssignments<{ target: string; transition: string }>('transition_button_state')
	readonly suiteButtons = new Map<string, Map<string, SuiteButton>>()
	private sourceRefreshTimer?: NodeJS.Timeout
	private macroCatalogRefreshTimer?: NodeJS.Timeout
	private macroFlashTimer?: NodeJS.Timeout
	private timelineRefreshTimer?: NodeJS.Timeout
	private transitionRefreshTimer?: NodeJS.Timeout
	private timelinePulseTimer?: NodeJS.Timeout
	private reportedStatus?: InstanceStatus
	private automaticConnectChain: Promise<void> = Promise.resolve()
	private readonly manuallyDisconnectedSuites = new Set<SuiteId>()
	// The protocol announces DISCONNECTED before its cleanup finishes; a connect
	// waits for that cleanup so the finished close cannot overwrite the new link.
	private readonly suiteDisconnects = new Map<SuiteId, Promise<void>>()
	private readonly automaticConnectInProgress = new Set<SuiteId>()
	private readonly automaticConnectQueued = new Set<SuiteId>()
	private readonly automaticAttempts = new Map<SuiteId, number>()
	private readonly automaticRetryTimers = new Map<SuiteId, NodeJS.Timeout>()
	private publishedRuntimeState = ''
	private readonly suiteStatusWaiters = new Set<() => void>()
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
			// Only paused macros flash; skip the redraw when none is paused.
			const paused = SUITES.some((suite) =>
				Object.values(protocol.getMacroRunState(this.connectionId(suite))?.macroStatus ?? {}).includes(7),
			)
			if (paused) this.checkFeedbacks('macro_button_state')
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
		this.clearAutomaticRetries()
		for (const state of Object.values(this.suiteStates)) if (state.timer) clearTimeout(state.timer)
		for (const id of SUITES)
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		this.checkFeedbacks('connection_state')
		this.updateRuntimeState()
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
		const generation = ++this.connectionConfigGeneration
		this.config = config
		this.manuallyDisconnectedSuites.clear()
		this.clearAutomaticRetries()
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
		// destroy() or a newer configUpdated() ran during the await and owns state now.
		if (generation !== this.connectionConfigGeneration) return
		for (const id of SUITES) {
			if (this.suiteStates[id].timer) clearTimeout(this.suiteStates[id].timer)
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		}
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
			this.checkFeedbacks('aux_button_state', 'crosspoint_button_state', 'image_store_input_state')
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
			// The flash is the only change; skip the full runtime refresh below.
			return
		} else if (type === 'MACRO_CATALOG_READY') {
			this.updateActions()
			this.updatePresets()
			this.checkFeedbacks('macro_button_state', 'action_label')
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
			this.checkFeedbacks('macro_active', 'macro_button_state', 'action_label')
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
		} else if (type === 'WARNING') {
			// Non-fatal: a failed send or persistence error leaves the link up.
			this.log('warn', `Suite ${suiteNumber(id)}: ${String(message)}`)
		} else if (type === 'SUB_PARSE_ERROR') {
			this.log('warn', `FRAME Suite ${suiteNumber(id)}: subscription parse error: ${String(message)}`)
		} else if (['ERROR', 'DISCONNECTED', 'HANDSHAKE_TIMEOUT_ERROR', 'HEARTBEAT_TIMEOUT'].includes(type)) {
			state.status = 'disconnected'
			state.connectionPhase = undefined
			state.frameVersion = ''
			state.protocolName = ''
			state.heartbeatFlash = false
			if (state.timer) clearTimeout(state.timer)
			state.timer = undefined
			this.checkFeedbacks('connection_state')
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
		if (!automatic) this.manuallyDisconnectedSuites.delete(id)
		if (!this.config.host) {
			this.reportedStatus = InstanceStatus.BadConfig
			this.updateStatus(InstanceStatus.BadConfig, 'Target IP is required')
			return false
		}
		await this.suiteDisconnects.get(id)?.catch(() => undefined)
		const state = this.suiteStates[id]
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
				MODULE_VERSION,
				MODULE_BUILD_DATE,
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

	// Resolved from updateRuntimeState(), which runs after every suite status change.
	private async waitForSuiteConnection(id: SuiteId, timeoutMs: number): Promise<boolean> {
		const settled = (): boolean | undefined => {
			const status = this.suiteStates[id].status
			return status === 'connected' ? true : status === 'disconnected' ? false : undefined
		}
		const initial = settled()
		if (initial !== undefined) return initial
		return new Promise((resolve) => {
			const finish = (connected: boolean): void => {
				clearTimeout(timer)
				this.suiteStatusWaiters.delete(check)
				resolve(connected)
			}
			const check = (): void => {
				const result = settled()
				if (result !== undefined) finish(result)
			}
			const timer = setTimeout(() => finish(false), timeoutMs)
			this.suiteStatusWaiters.add(check)
		})
	}

	async disconnectSuite(value: unknown): Promise<void> {
		const id = suiteId(value)
		this.manuallyDisconnectedSuites.add(id)
		this.clearAutomaticRetry(id)
		const closing = (async () => {
			await protocol.disconnectConnection(this.connectionId(id))
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
			if (!this.shuttingDown) this.handleSourceNamesUpdated(this.connectionId(id))
			this.updateRuntimeState()
		})()
		this.suiteDisconnects.set(id, closing)
		try {
			await closing
		} finally {
			if (this.suiteDisconnects.get(id) === closing) this.suiteDisconnects.delete(id)
		}
	}

	isSuiteDisconnecting(value: unknown): boolean {
		return this.suiteDisconnects.has(suiteId(value))
	}

	private isSuiteSelected(id: SuiteId): boolean {
		return suiteEnabled(this.config, suiteNumber(id))
	}

	private queueSelectedSuiteCascade(): void {
		for (const id of SUITES) if (this.isSuiteSelected(id)) this.queueAutomaticConnect(id)
	}

	// Suites connect one at a time because the frame handles one handshake per
	// client at a time. A failed attempt re-queues behind the other suites, so one
	// unreachable suite cannot hold the rest back.
	private queueAutomaticConnect(id: SuiteId): void {
		if (this.automaticConnectQueued.has(id) || this.automaticRetryTimers.has(id)) return
		this.automaticConnectQueued.add(id)
		const generation = this.connectionConfigGeneration
		this.automaticConnectChain = this.automaticConnectChain.then(async () => {
			try {
				await this.connectAutomatically(id, generation)
			} finally {
				this.automaticConnectQueued.delete(id)
			}
		})
	}

	private shouldConnectAutomatically(id: SuiteId, generation: number): boolean {
		return (
			generation === this.connectionConfigGeneration &&
			!this.shuttingDown &&
			this.isSuiteSelected(id) &&
			!this.manuallyDisconnectedSuites.has(id)
		)
	}

	// One attempt. On failure, retry after FAST_RETRY_MS for the configured number
	// of reconnection attempts, then keep trying every SLOW_RETRY_MS so a frame
	// that comes back after a long outage is picked up without a button press.
	private async connectAutomatically(id: SuiteId, generation: number): Promise<void> {
		if (!this.shouldConnectAutomatically(id, generation)) return
		if (await this.connectSuite(id, true, generation)) {
			this.automaticAttempts.delete(id)
			return
		}
		// Missing IP is a config error; retrying cannot succeed until configUpdated().
		if (!this.config.host || !this.shouldConnectAutomatically(id, generation)) return
		const failures = (this.automaticAttempts.get(id) ?? 0) + 1
		this.automaticAttempts.set(id, failures)
		const retries = maximumRetries(this.config)
		if (failures === retries + 1)
			this.log(
				'warn',
				`Suite ${suiteNumber(id)}: maximum reconnection attempts reached; retrying every ${SLOW_RETRY_MS / 1000} s`,
			)
		const timer = setTimeout(
			() => {
				this.automaticRetryTimers.delete(id)
				if (this.shouldConnectAutomatically(id, generation)) this.queueAutomaticConnect(id)
			},
			failures <= retries ? FAST_RETRY_MS : SLOW_RETRY_MS,
		)
		this.automaticRetryTimers.set(id, timer)
	}

	private clearAutomaticRetry(id: SuiteId): void {
		clearTimeout(this.automaticRetryTimers.get(id))
		this.automaticRetryTimers.delete(id)
		this.automaticAttempts.delete(id)
	}

	private clearAutomaticRetries(): void {
		for (const id of SUITES) this.clearAutomaticRetry(id)
	}

	send(command: () => CommandResult): void {
		const result = command()
		if (!result.success) this.log('warn', result.message)
	}

	// Every labelled action records its button's assignment here; the matching
	// feedback reads it back to draw the label, badge and tally.
	trackButton<T>(assignments: ButtonAssignments<T>, action: ButtonAction, fields: T): void {
		const style = buttonStyle(action.options)
		assignments.setAction(action.controlId, action.id, { ...style, ...fields })
		this.trackSuiteButton(action.controlId, action.id, style)
		this.checkFeedbacks(assignments.feedbackId)
	}

	untrackButton<T>(assignments: ButtonAssignments<T>, action: { id: string; controlId: string }): void {
		assignments.deleteAction(action.controlId, action.id)
		this.untrackSuiteButton(action.controlId, action.id)
		this.checkFeedbacks(assignments.feedbackId)
	}

	trackSuiteButton(controlId: string, actionId: string, { suite, textSize, showSuite }: SuiteButton): void {
		const actions = this.suiteButtons.get(controlId) ?? new Map<string, SuiteButton>()
		actions.set(actionId, { suite, textSize, showSuite })
		this.suiteButtons.set(controlId, actions)
		this.checkFeedbacks('suite_badge')
	}

	primarySuiteButton(controlId: string): SuiteButton | undefined {
		return primaryAction(this.suiteButtons.get(controlId))
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
		for (const check of [...this.suiteStatusWaiters]) check()
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
		const values = Object.fromEntries(
			SUITES.flatMap((id) => {
				const n = suiteNumber(id),
					state = this.suiteStates[id]
				return [
					[`suite${n}_connection_status`, state.status],
					[`suite${n}_protocol`, state.protocolName],
					[`suite${n}_frame_version`, state.frameVersion],
				]
			}),
		)
		// Feedbacks below depend on connection state only through these values and
		// the connection phase; redraw every button only when one of them changed.
		const published = JSON.stringify([values, SUITES.map((id) => this.suiteStates[id].connectionPhase ?? '')])
		if (published === this.publishedRuntimeState) return
		this.publishedRuntimeState = published
		this.setVariableValues(values)
		this.checkFeedbacks(
			'connected',
			'connection_state',
			'macro_active',
			'macro_button_state',
			'action_label',
			'aux_button_state',
			'crosspoint_button_state',
			'image_store_button_state',
			'image_store_input_state',
			'panel_memory_button_state',
			'gpi_button_state',
			'pbus_button_state',
			'button_mapping_state',
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
