import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { protocol, type CommandResult } from './protocol.js'

const CONNECTION_ID = 'frame'

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
	connectionStatus = 'disconnected'
	frameVersion = ''
	protocolName = ''

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
		if (config.autoConnect !== false && config.host) await this.connectFrame()
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		protocol.clientEmitter.off('status', this.handleProtocolStatus)
		await protocol.disconnectConnection(CONNECTION_ID)
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		await protocol.disconnectConnection(CONNECTION_ID)
		this.connectionStatus = 'disconnected'
		this.updateRuntimeState()
		if (config.autoConnect !== false && config.host) await this.connectFrame()
	}

	private handleProtocolStatus = (connectionId: string, type: string, message: unknown): void => {
		if (connectionId !== CONNECTION_ID) return
		if (type === 'CONNECTED') {
			this.connectionStatus = 'connected'
			const info = protocol.getConnectionInfo(CONNECTION_ID)
			this.frameVersion = info?.frameVersion ?? ''
			this.protocolName = info?.protocol?.toUpperCase() ?? ''
			this.updateStatus(InstanceStatus.Ok)
			protocol.subscribeToSourceNames(CONNECTION_ID)
			setTimeout(() => protocol.subscribeToAuxBus(CONNECTION_ID), 200)
			setTimeout(() => protocol.subscribeToMEBus(CONNECTION_ID), 400)
		} else if (type === 'FRAME_VERSION' && message && typeof message === 'object' && 'version' in message) {
			this.frameVersion = String(message.version)
		} else if (['ERROR', 'DISCONNECTED', 'HANDSHAKE_TIMEOUT_ERROR', 'HEARTBEAT_TIMEOUT'].includes(type)) {
			this.connectionStatus = 'disconnected'
			const detail = typeof message === 'string' ? message : type
			this.updateStatus(InstanceStatus.ConnectionFailure, detail)
		} else if (type === 'CONNECTING' || type === 'HANDSHAKE_COMPLETE') {
			this.connectionStatus = 'connecting'
			this.updateStatus(InstanceStatus.Connecting)
		}
		this.updateRuntimeState()
	}

	async connectFrame(): Promise<void> {
		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'Target IP is required')
			return
		}
		this.connectionStatus = 'connecting'
		this.updateStatus(InstanceStatus.Connecting)
		this.updateRuntimeState()
		try {
			const suite = this.config.suite || 'suite1a'
			const suiteNumber = Number(/^suite([1-4])a$/.exec(suite)?.[1] ?? 1)
			const defaultMainPort = 6130 + suiteNumber * 2
			await protocol.createConnection(
				CONNECTION_ID,
				this.config.host,
				suite,
				{
					mainPort: this.config.customPorts ? this.config.mainPort || defaultMainPort : defaultMainPort,
					listenerPort: this.config.customPorts ? this.config.listenerPort || defaultMainPort + 1 : defaultMainPort + 1,
				},
				suite.replace('suite', 'Suite ').replace('a', ''),
				'2026.0.9.1',
				'Aug 27 2026',
			)
		} catch (error) {
			this.connectionStatus = 'disconnected'
			this.updateStatus(InstanceStatus.ConnectionFailure, String(error))
			this.updateRuntimeState()
		}
	}

	async disconnectFrame(): Promise<void> {
		await protocol.disconnectConnection(CONNECTION_ID)
		this.connectionStatus = 'disconnected'
		this.frameVersion = ''
		this.protocolName = ''
		this.updateStatus(InstanceStatus.Disconnected)
		this.updateRuntimeState()
	}

	send(command: () => CommandResult): void {
		const result = command()
		if (!result.success) this.log('warn', result.message)
	}

	private updateRuntimeState(): void {
		this.setVariableValues({
			connection_status: this.connectionStatus,
			protocol: this.protocolName,
			frame_version: this.frameVersion,
		})
		this.checkFeedbacks('connected', 'macro_active')
	}

	get protocol(): ProtocolManagerFacade {
		return { raw: protocol, id: CONNECTION_ID }
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

export type ProtocolManagerFacade = { raw: typeof protocol; id: typeof CONNECTION_ID }
