import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = [
		{
			id: 'core',
			name: 'Connection and Macros',
			definitions: [
				{
					id: 'core-buttons',
					name: 'Connection and macro controls',
					description: 'Connection and macro starter buttons',
					type: 'simple',
					presets: ['connection', 'connect', 'disconnect', 'macro1', 'macro-stop1', 'stopall'],
				},
			],
		},
		{
			id: 'switcher',
			name: 'Switcher Controls',
			definitions: [
				{
					id: 'switcher-buttons',
					name: 'Switcher controls',
					description: 'Routing, E-MEM, and transition starter buttons',
					type: 'simple',
					presets: ['aux1-source1', 'pgm-black', 'emem0', 'cut-pgm', 'auto-pgm'],
				},
			],
		},
		{
			id: 'devices',
			name: 'Panel and Device Controls',
			definitions: [
				{
					id: 'device-buttons',
					name: 'Panel and device controls',
					description: 'Panel memory, Image Store, GPI, PBUS, and mapping starter buttons',
					type: 'simple',
					presets: [
						'panel-memory1',
						'image-store1',
						'image-input1',
						'master-run',
						'gpi1',
						'pbus-recall',
						'pbus-trigger',
						'button-map',
					],
				},
			],
		},
		{
			id: 'advanced',
			name: 'Advanced',
			definitions: [
				{
					id: 'advanced-buttons',
					name: 'Advanced controls',
					description: 'Raw CPL engineering button',
					type: 'simple',
					presets: ['raw-cpl'],
				},
			],
		},
	]
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		connection: {
			type: 'simple',
			name: 'Switcher Connection',
			style: { text: 'CONNECTION', size: 'auto', color: 0xffffff, bgcolor: 0xb00000 },
			steps: [{ down: [{ actionId: 'connection_toggle', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'connection_state', options: {} }],
		},
		connect: {
			type: 'simple',
			name: 'Connection',
			style: { text: 'GV\n$(grassvalley-kframe:connection_status)', size: 'auto', color: 0xffffff, bgcolor: 0x333333 },
			steps: [{ down: [{ actionId: 'connect', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: 0x00aa00 } }],
		},
		disconnect: {
			type: 'simple',
			name: 'Disconnect',
			style: { text: 'GV\nDISCONNECT', size: 'auto', color: 0xffffff, bgcolor: 0x661111 },
			steps: [{ down: [{ actionId: 'disconnect', options: {} }], up: [] }],
			feedbacks: [],
		},
		macro1: {
			type: 'simple',
			name: 'Macro 1',
			style: { text: 'MACRO\n1', size: 'auto', color: 0xffffff, bgcolor: 0x5a189a },
			steps: [{ down: [{ actionId: 'macro_play', options: { value: 1 } }], up: [] }],
			feedbacks: [{ feedbackId: 'macro_active', options: { macro: 1 }, style: { bgcolor: 0xffa500, color: 0x000000 } }],
		},
		'macro-stop1': {
			type: 'simple',
			name: 'Stop Macro 1',
			style: { text: 'STOP\nMACRO 1', size: 'auto', color: 0xffffff, bgcolor: 0x8b0000 },
			steps: [{ down: [{ actionId: 'macro_stop', options: { value: 1 } }], up: [] }],
			feedbacks: [],
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
		'aux1-source1': {
			type: 'simple',
			name: 'AUX 1 Source 1',
			style: { text: 'AUX 1\nSRC 1', size: 'auto', color: 0xffffff, bgcolor: 0x005f73 },
			steps: [{ down: [{ actionId: 'aux_route', options: { aux: 1, source: 1, transition: 'cut' } }], up: [] }],
			feedbacks: [],
		},
		'cut-pgm': {
			type: 'simple',
			name: 'PGM Primary Cut',
			style: { text: 'PGM PRI\nCUT', size: 'auto', color: 0xffffff, bgcolor: 0xaa0000 },
			steps: [{ down: [{ actionId: 'transition', options: { target: 'PGM_PRI', transition: 'cut' } }], up: [] }],
			feedbacks: [],
		},
		'auto-pgm': {
			type: 'simple',
			name: 'PGM Primary Auto',
			style: { text: 'PGM PRI\nAUTO', size: 'auto', color: 0x000000, bgcolor: 0xffd000 },
			steps: [{ down: [{ actionId: 'transition', options: { target: 'PGM_PRI', transition: 'auto' } }], up: [] }],
			feedbacks: [],
		},
		'panel-memory1': {
			type: 'simple',
			name: 'Panel Memory 1',
			style: { text: 'PANEL\nMEM 1', size: 'auto', color: 0xffffff, bgcolor: 0x3a506b },
			steps: [{ down: [{ actionId: 'panel_memory', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		'image-store1': {
			type: 'simple',
			name: 'Image Store 1',
			style: { text: 'IMAGE\nSTORE 1', size: 'auto', color: 0xffffff, bgcolor: 0x6a4c93 },
			steps: [{ down: [{ actionId: 'image_store', options: { output: 1, image: 1 } }], up: [] }],
			feedbacks: [],
		},
		'image-input1': {
			type: 'simple',
			name: 'Image Store Input 1',
			style: { text: 'IMAGE IN\n1', size: 'auto', color: 0xffffff, bgcolor: 0x6a4c93 },
			steps: [{ down: [{ actionId: 'image_store_input', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		'master-run': {
			type: 'simple',
			name: 'Master Timeline RUN',
			style: { text: 'MASTER\nRUN', size: 'auto', color: 0x000000, bgcolor: 0xffd000 },
			steps: [{ down: [{ actionId: 'run', options: { target: 'MASTER' } }], up: [] }],
			feedbacks: [],
		},
		gpi1: {
			type: 'simple',
			name: 'GPI 1',
			style: { text: 'GPI\n1', size: 'auto', color: 0xffffff, bgcolor: 0xf77f00 },
			steps: [{ down: [{ actionId: 'gpi', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		'pbus-recall': {
			type: 'simple',
			name: 'PBUS 1 Recall 0',
			style: { text: 'PBUS 1\nRECALL 0', size: 'auto', color: 0x000000, bgcolor: 0xffbf00 },
			steps: [{ down: [{ actionId: 'pbus_recall', options: { pbus: 1, register: 0 } }], up: [] }],
			feedbacks: [],
		},
		'pbus-trigger': {
			type: 'simple',
			name: 'PBUS 1 Trigger 0',
			style: { text: 'PBUS 1\nTRIGGER 0', size: 'auto', color: 0x000000, bgcolor: 0xffbf00 },
			steps: [{ down: [{ actionId: 'pbus_trigger', options: { pbus: 1, trigger: 0 } }], up: [] }],
			feedbacks: [],
		},
		'button-map': {
			type: 'simple',
			name: 'Map PGM Shift 1 Button 1',
			style: { text: 'MAP PGM\nS1 B1→1', size: 'auto', color: 0x000000, bgcolor: 0x39ff14 },
			steps: [
				{ down: [{ actionId: 'button_mapping', options: { bus: 'program', shift: 1, button: 1, source: 1 } }], up: [] },
			],
			feedbacks: [],
		},
		'raw-cpl': {
			type: 'simple',
			name: 'Raw CPL Command',
			style: { text: 'RAW\nCPL', size: 'auto', color: 0xffffff, bgcolor: 0x333333 },
			steps: [{ down: [{ actionId: 'raw_cpl', options: { command: '' } }], up: [] }],
			feedbacks: [],
		},
	}
	self.setPresetDefinitions(structure, presets)
}
