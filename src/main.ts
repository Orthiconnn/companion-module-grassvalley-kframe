import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { protocol, type CommandResult } from './protocol.js'

export const SUITES = ['suite1a', 'suite2a', 'suite3a', 'suite4a'] as const
export type SuiteId = (typeof SUITES)[number]
export type SuiteState = {
	status: string
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

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		protocol.initialize(null)
		protocol.clientEmitter.on('status', this.handleProtocolStatus)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updatePresets() // export Presets
		this.updateVariableDefinitions() // export variable definitions
		this.updateRuntimeState()
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		for (const state of Object.values(this.suiteStates)) if (state.timer) clearTimeout(state.timer)
		protocol.clientEmitter.off('status', this.handleProtocolStatus)
		await Promise.all(SUITES.map(async (id) => protocol.disconnectConnection(this.connectionId(id))))
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		await Promise.all(SUITES.map(async (id) => protocol.disconnectConnection(this.connectionId(id))))
		for (const id of SUITES)
			this.suiteStates[id] = { status: 'disconnected', frameVersion: '', protocolName: '', heartbeatFlash: false }
		this.updateRuntimeState()
	}

	private handleProtocolStatus = (connectionId: string, type: string, message: unknown): void => {
		const id = SUITES.find((suite) => this.connectionId(suite) === connectionId)
		if (!id) return
		const state = this.suiteStates[id]
		if (type === 'CONNECTED') {
			state.status = 'connected'
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
		} else if (type === 'FRAME_VERSION' && message && typeof message === 'object' && 'version' in message) {
			state.frameVersion = String(message.version)
		} else if (['ERROR', 'DISCONNECTED', 'HANDSHAKE_TIMEOUT_ERROR', 'HEARTBEAT_TIMEOUT'].includes(type)) {
			state.status = 'disconnected'
			const detail = typeof message === 'string' ? message : type
			this.log('warn', `Suite ${suiteNumber(id)}: ${detail}`)
		} else if (type === 'CONNECTING' || type === 'HANDSHAKE_COMPLETE') {
			state.status = 'connecting'
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
		this.macroButtons.set(controlId, { suite: suiteId(suite), macro: Number(macro) || 1 })
		this.checkFeedbacks('macro_button_state')
	}

	untrackMacroButton(controlId: string): void {
		this.macroButtons.delete(controlId)
		this.checkFeedbacks('macro_button_state')
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
		this.checkFeedbacks('connected', 'connection_state', 'macro_active', 'macro_button_state')
	}

	get protocol(): typeof protocol {
		return protocol
	}

	connectionId(id: SuiteId): string {
		return `${this.id}:${id}`
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
