import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = [
		{
			id: 'core',
			name: 'Grass Valley Controls',
			definitions: [
				{
					id: 'core-buttons',
					name: 'Core controls',
					description: 'Starting buttons for GV K-Frame control',
					type: 'simple',
					presets: ['connect', 'macro1', 'stopall', 'emem0', 'pgm-black'],
				},
			],
		},
	]
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		connect: {
			type: 'simple',
			name: 'Connection',
			style: { text: 'GV\n$(grassvalley-kframe:connection_status)', size: 'auto', color: 0xffffff, bgcolor: 0x333333 },
			steps: [{ down: [{ actionId: 'connect', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: 0x00aa00 } }],
		},
		macro1: {
			type: 'simple',
			name: 'Macro 1',
			style: { text: 'MACRO\n1', size: 'auto', color: 0xffffff, bgcolor: 0x5a189a },
			steps: [{ down: [{ actionId: 'macro_play', options: { value: 1 } }], up: [] }],
			feedbacks: [{ feedbackId: 'macro_active', options: { macro: 1 }, style: { bgcolor: 0xffa500, color: 0x000000 } }],
		},
		stopall: {
			type: 'simple',
			name: 'Stop all macros',
			style: { text: 'STOP\nALL', size: 'auto', color: 0xffffff, bgcolor: 0xaa0000 },
			steps: [{ down: [{ actionId: 'macro_stop_all', options: {} }], up: [] }],
			feedbacks: [],
		},
		emem0: {
			type: 'simple',
			name: 'Master E-MEM 0',
			style: { text: 'MASTER\nE-MEM 0', size: 'auto', color: 0xffffff, bgcolor: 0xd65f00 },
			steps: [{ down: [{ actionId: 'emem', options: { target: 'MASTER', register: 0 } }], up: [] }],
			feedbacks: [],
		},
		'pgm-black': {
			type: 'simple',
			name: 'PGM A Black',
			style: { text: 'PGM A\nBLACK', size: 'auto', color: 0xffffff, bgcolor: 0x222222 },
			steps: [{ down: [{ actionId: 'crosspoint', options: { target: 'PGM_A', source: 740 } }], up: [] }],
			feedbacks: [],
		},
	}
	self.setPresetDefinitions(structure, presets)
}
