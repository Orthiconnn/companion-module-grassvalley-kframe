import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: Record<string, never> }
	macro_active: { type: 'boolean'; options: { macro: number } }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
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
