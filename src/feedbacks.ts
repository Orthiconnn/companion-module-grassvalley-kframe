import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: Record<string, never> }
	connection_state: { type: 'advanced'; options: Record<string, never> }
	macro_active: { type: 'boolean'; options: { macro: number } }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		connection_state: {
			name: 'Connection state, ports, and heartbeat',
			type: 'advanced',
			options: [],
			callback: () => {
				const [mainPort] = self.suitePorts
				const suite = Number(/^suite([1-4])a$/.exec(self.config.suite || 'suite1a')?.[1] ?? 1)
				const heartbeat = self.heartbeatFlash ? '●' : '○'
				if (self.connectionStatus === 'connected') {
					const info = self.protocol.raw.getConnectionInfo(self.protocol.id)
					const protocol = (self.protocolName || info?.protocol || 'UDP').toUpperCase()
					const livePort = info?.ports.dynamic || (protocol === 'TCP' ? 5000 : mainPort)
					const version = self.frameVersion ? `\n${self.frameVersion}` : ''
					return {
						text: `Suite ${suite}\nConnected\n${protocol}:${livePort}${version}\n${heartbeat}`,
						bgcolor: 0x287a0b,
						color: 0xffffff,
						size: 14,
					}
				}
				if (self.connectionStatus === 'connecting') {
					return {
						text: `Suite ${suite}\nConnecting\nEstablishing\nHeartbeat\n○`,
						bgcolor: 0xb88600,
						color: 0xffffff,
						size: 14,
					}
				}
				return {
					text: `Suite ${suite}\nNot\nConnected\n \n○`,
					bgcolor: 0xa80000,
					color: 0xffffff,
					size: 14,
				}
			},
		},
		connected: {
			name: 'Connection is online',
			type: 'boolean',
			options: [],
			defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
			callback: () => self.connectionStatus === 'connected',
		},
		macro_active: {
			name: 'Macro is playing or paused',
			type: 'boolean',
			options: [{ id: 'macro', type: 'number', label: 'Macro', default: 1, min: 1, max: 999 }],
			defaultStyle: { bgcolor: 0xffa500, color: 0x000000 },
			callback: (feedback) => {
				const status = self.protocol.raw.getMacroStatus(self.protocol.id, Number(feedback.options.macro))
				return status !== null && status !== 0
			},
		},
	})
}
