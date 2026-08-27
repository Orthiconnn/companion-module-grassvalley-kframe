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
				const [mainPort, listenerPort] = self.suitePorts
				const suite = Number(/^suite([1-4])a$/.exec(self.config.suite || 'suite1a')?.[1] ?? 1)
				const heartbeat = self.heartbeatFlash ? '●' : '○'
				if (self.connectionStatus === 'connected') {
					return {
						text: `SUITE ${suite} ${heartbeat}\n${mainPort}/${listenerPort}\nCONNECTED`,
						bgcolor: 0x008000,
						color: 0xffffff,
					}
				}
				if (self.connectionStatus === 'connecting') {
					return {
						text: `SUITE ${suite} ○\n${mainPort}/${listenerPort}\nHANDSHAKE`,
						bgcolor: 0xffc000,
						color: 0x000000,
					}
				}
				return {
					text: `SUITE ${suite} ○\n${mainPort}/${listenerPort}\nDISCONNECTED`,
					bgcolor: 0xb00000,
					color: 0xffffff,
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
