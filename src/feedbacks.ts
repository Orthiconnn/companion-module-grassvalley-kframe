import type ModuleInstance from './main.js'
import { suiteId, suiteNumber, suitePorts } from './main.js'
import { SUITE_BADGES } from './badges.js'

type SuiteOptions = { suite?: string }
export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: SuiteOptions }
	connection_state: { type: 'advanced'; options: SuiteOptions }
	macro_active: { type: 'boolean'; options: SuiteOptions & { macro: number } }
	macro_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
}

const suiteOption = {
	id: 'suite' as const,
	type: 'dropdown' as const,
	label: 'Suite',
	default: 'suite1a',
	choices: [
		{ id: 'suite1a', label: 'Suite 1' },
		{ id: 'suite2a', label: 'Suite 2' },
		{ id: 'suite3a', label: 'Suite 3' },
		{ id: 'suite4a', label: 'Suite 4' },
	],
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		connection_state: {
			name: 'Connection state, port, and heartbeat',
			type: 'advanced',
			options: [suiteOption],
			callback: (feedback) => {
				const id = suiteId(feedback.options.suite),
					state = self.suiteStates[id]
				const [mainPort] = suitePorts(id),
					heartbeat = state.heartbeatFlash ? '●' : '○'
				if (state.status === 'connected') {
					const info = self.protocol.getConnectionInfo(self.connectionId(id))
					const protocolName = (state.protocolName || info?.protocol || 'UDP').toUpperCase()
					const livePort = info?.ports.dynamic || (protocolName === 'TCP' ? 5000 : mainPort)
					const version = state.frameVersion ? `\n${state.frameVersion}` : ''
					return {
						text: `Suite ${suiteNumber(id)}\nConnected\n${protocolName}:${livePort}${version}\n${heartbeat}`,
						bgcolor: 0x287a0b,
						color: 0xffffff,
						size: 10,
					}
				}
				if (state.status === 'connecting')
					return {
						text: `Suite ${suiteNumber(id)}\nConnecting\nEstablishing\nHeartbeat\n○`,
						bgcolor: 0xb88600,
						color: 0xffffff,
						size: 10,
					}
				return { text: `Suite ${suiteNumber(id)}\nNot\nConnected\n \n○`, bgcolor: 0xa80000, color: 0xffffff, size: 10 }
			},
		},
		connected: {
			name: 'Connection is online',
			type: 'boolean',
			options: [suiteOption],
			defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
			callback: (feedback) => self.suiteStates[suiteId(feedback.options.suite)].status === 'connected',
		},
		macro_active: {
			name: 'Macro is playing or paused',
			type: 'boolean',
			options: [suiteOption, { id: 'macro', type: 'number', label: 'Macro', default: 1, min: 1, max: 999 }],
			defaultStyle: { bgcolor: 0xffa500, color: 0x000000 },
			callback: (feedback) => {
				const status = self.protocol.getMacroStatus(
					self.connectionId(suiteId(feedback.options.suite)),
					Number(feedback.options.macro),
				)
				return status !== null && status !== 0
			},
		},
		macro_button_state: {
			name: 'Macro button label, suite badge, and active state',
			type: 'advanced',
			options: [
				{
					id: 'automaticLabel',
					type: 'checkbox',
					label: 'Automatically show Macro number',
					default: true,
				},
			],
			callback: (feedback) => {
				const assignment = self.macroButtons.get(feedback.controlId)
				if (!assignment) return {}
				const status = self.protocol.getMacroStatus(self.connectionId(assignment.suite), assignment.macro)
				return {
					...(feedback.options.automaticLabel ? { text: `Macro\n${assignment.macro}` } : {}),
					png64: SUITE_BADGES[suiteNumber(assignment.suite)],
					pngalignment: 'left:bottom',
					bgcolor: status !== null && status !== 0 ? 0xffa500 : 0x285b0b,
					color: status !== null && status !== 0 ? 0x000000 : 0xffffff,
					size: 10,
				}
			},
		},
	})
}
