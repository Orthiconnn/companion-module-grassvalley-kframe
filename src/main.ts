import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
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
	const main = 6130 + suiteNumber(id) * 2
	return [main, main + 1]
}

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	readonly suiteStates = Object.fromEntries(
		SUITES.map((id) => [id, { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }]),
	) as Record<SuiteId, SuiteState>
	readonly macroButtons = new Map<string, { suite: SuiteId; macro: number }>()
	readonly auxButtons = new Map<string, { suite: SuiteId; aux: number; source: number }>()
	readonly suiteButtons = new Map<string, Map<string, SuiteId>>()
	private sourceRefreshTimer?: NodeJS.Timeout
	private macroCatalogRefreshTimer?: NodeJS.Timeout
	private macroFlashTimer?: NodeJS.Timeout
	macroFlashOn = false

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		protocol.initialize(null)
		protocol.clientEmitter.on('status', this.handleProtocolStatus)
		protocol.clientEmitter.on('sourceNamesUpdated', this.handleSourceNamesUpdated)
		protocol.clientEmitter.on('auxStateChanged', this.handleAuxStateChanged)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updatePresets() // export Presets
		this.updateVariableDefinitions() // export variable definitions
		this.updateRuntimeState()
		this.macroFlashTimer = setInterval(() => {
			this.macroFlashOn = !this.macroFlashOn
			this.checkFeedbacks('macro_button_state')
		}, 500)
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		for (const state of Object.values(this.suiteStates)) if (state.timer) clearTimeout(state.timer)
		if (this.sourceRefreshTimer) clearTimeout(this.sourceRefreshTimer)
		if (this.macroCatalogRefreshTimer) clearTimeout(this.macroCatalogRefreshTimer)
		if (this.macroFlashTimer) clearInterval(this.macroFlashTimer)
		protocol.clientEmitter.off('status', this.handleProtocolStatus)
		protocol.clientEmitter.off('sourceNamesUpdated', this.handleSourceNamesUpdated)
		protocol.clientEmitter.off('auxStateChanged', this.handleAuxStateChanged)
		await Promise.all(SUITES.map(async (id) => protocol.disconnectConnection(this.connectionId(id))))
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		if (this.sourceRefreshTimer) {
			clearTimeout(this.sourceRefreshTimer)
			this.sourceRefreshTimer = undefined
		}
		if (this.macroCatalogRefreshTimer) {
			clearTimeout(this.macroCatalogRefreshTimer)
			this.macroCatalogRefreshTimer = undefined
		}
		await Promise.all(SUITES.map(async (id) => protocol.disconnectConnection(this.connectionId(id))))
		for (const id of SUITES)
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		this.updateActions()
		this.updatePresets()
		this.updateRuntimeState()
	}

	private handleSourceNamesUpdated = (connectionId: string): void => {
		if (!SUITES.some((suite) => this.connectionId(suite) === connectionId)) return
		if (this.sourceRefreshTimer) clearTimeout(this.sourceRefreshTimer)
		this.sourceRefreshTimer = setTimeout(() => {
			this.sourceRefreshTimer = undefined
			this.updateActions()
			this.updatePresets()
			this.checkFeedbacks('aux_button_state')
		}, 100)
	}

	private handleAuxStateChanged = (connectionId: string): void => {
		if (!SUITES.some((suite) => this.connectionId(suite) === connectionId)) return
		this.checkFeedbacks('aux_button_state')
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
		} else if (type === 'FRAME_VERSION' && message && typeof message === 'object' && 'version' in message) {
			state.frameVersion = String(message.version)
		} else if (['ERROR', 'DISCONNECTED', 'HANDSHAKE_TIMEOUT_ERROR', 'HEARTBEAT_TIMEOUT'].includes(type)) {
			state.status = 'disconnected'
			const detail = typeof message === 'string' ? message : type
			this.log('warn', `Suite ${suiteNumber(id)}: ${detail}`)
		} else if (type === 'CONNECTING' || type === 'HANDSHAKE_COMPLETE') {
			state.status = 'connecting'
			const detail = String(message).toLowerCase()
			state.connectionPhase =
				type === 'HANDSHAKE_COMPLETE' || /handshake|auth|registration/.test(detail) ? 'handshake' : 'establishing'
		}
		this.updateRuntimeState()
	}

	async connectSuite(value: unknown): Promise<void> {
		const id = suiteId(value)
		const state = this.suiteStates[id]
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Target IP is required')
			return
		}
		state.status = 'connecting'
		state.connectionPhase = 'establishing'
		this.updateRuntimeState()
		try {
			const [mainPort, listenerPort] = suitePorts(id)
			await protocol.createConnection(
				this.connectionId(id),
				this.config.host,
				id,
				{ mainPort, listenerPort },
				`Suite ${suiteNumber(id)}`,
				'2026.0.9.1',
				'Aug 27 2026',
			)
		} catch (error) {
			state.status = 'disconnected'
			this.log('warn', `Suite ${suiteNumber(id)}: ${String(error)}`)
			this.updateRuntimeState()
		}
	}

	async disconnectSuite(value: unknown): Promise<void> {
		const id = suiteId(value)
		await protocol.disconnectConnection(this.connectionId(id))
		this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		this.updateRuntimeState()
	}

	send(command: () => CommandResult): void {
		const result = command()
		if (!result.success) this.log('warn', result.message)
	}

	trackMacroButton(controlId: string, suite: unknown, macro: unknown): void {
		const targetSuite = suiteId(suite)
		this.macroButtons.set(controlId, { suite: targetSuite, macro: Number(macro) || 1 })
		this.checkFeedbacks('macro_button_state')
	}

	untrackMacroButton(controlId: string): void {
		this.macroButtons.delete(controlId)
		this.checkFeedbacks('macro_button_state')
	}

	trackAuxButton(controlId: string, suite: unknown, aux: unknown, source: unknown): void {
		const targetSuite = suiteId(suite)
		this.auxButtons.set(controlId, {
			suite: targetSuite,
			aux: Number(aux) || 1,
			source: Number(source) || 1,
		})
		this.trackSuiteButton(controlId, 'aux_route', targetSuite)
		this.checkFeedbacks('aux_button_state')
	}

	untrackAuxButton(controlId: string): void {
		this.auxButtons.delete(controlId)
		this.untrackSuiteButton(controlId, 'aux_route')
		this.checkFeedbacks('aux_button_state')
	}

	trackSuiteButton(controlId: string, actionId: string, suite: unknown): void {
		const actions = this.suiteButtons.get(controlId) ?? new Map<string, SuiteId>()
		actions.set(actionId, suiteId(suite))
		this.suiteButtons.set(controlId, actions)
		this.checkFeedbacks('suite_badge')
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
		this.updateStatus(
			statuses.includes('connected')
				? InstanceStatus.Ok
				: statuses.includes('connecting')
					? InstanceStatus.Connecting
					: InstanceStatus.Disconnected,
		)
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
		this.checkFeedbacks('connected', 'connection_state', 'macro_active', 'macro_button_state', 'aux_button_state')
	}

	get protocol(): typeof protocol {
		return protocol
	}

	connectionId(id: SuiteId): string {
		return `${this.id}:${id}`
	}

	sourceChoices(maximum: number): DropdownChoice<number>[] {
		const labels = new Map<number, string>()
		// Action definitions are module-wide, so the lowest-numbered connected suite
		// deterministically supplies the label when suites disagree about a source name.
		for (const suite of SUITES) {
			for (const source of protocol.getSourceNames(this.connectionId(suite))) {
				if (source.id < 1 || source.id > maximum || labels.has(source.id)) continue
				const name = source.menu || source.oled || source.panel || source.eng || source.short
				if (name) labels.set(source.id, name)
			}
		}
		if (!labels.has(1)) labels.set(1, 'Source 1')
		return [...labels.entries()]
			.sort(([a], [b]) => a - b)
			.map(([id, label]) => ({ id, label: label === `Source ${id}` ? label : `${id} — ${label}` }))
	}

	sourceDisplayName(source: number): string {
		const choice = this.sourceChoices(850).find((entry) => entry.id === source)
		return choice?.label ?? `Source ${source}`
	}

	macroChoices(): DropdownChoice<number>[] {
		const labels = new Map<number, string>()
		for (const suite of SUITES) {
			const catalog = protocol.getMacroCatalog(this.connectionId(suite)) ?? {}
			for (const [rawNumber, entry] of Object.entries(catalog)) {
				const macro = Number(rawNumber)
				if (macro < 1 || macro > 999 || labels.has(macro)) continue
				const name = entry.oled || entry.panel || entry.comment
				if (name) labels.set(macro, name)
			}
		}
		if (!labels.has(1)) labels.set(1, 'Macro 1')
		return [...labels.entries()]
			.sort(([a], [b]) => a - b)
			.map(([id, label]) => ({ id, label: label === `Macro ${id}` ? label : `${id} — ${label}` }))
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
