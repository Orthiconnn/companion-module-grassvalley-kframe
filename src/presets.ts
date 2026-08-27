import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

export function UpdatePresets(self: ModuleInstance): void {
	const structure: CompanionPresetSection[] = [
		{
			id: 'controls',
			name: 'Grass Valley Controls',
			definitions: [
				{
					id: 'all-buttons',
					name: 'All controls',
					description: 'All Stream Deck-inspired defaults in one group',
					type: 'simple',
					presets: [
						'connection',
						'aux1-source9',
						'aux2-source17',
						'aux3-source17',
						'aux4-source17',
						'macro1',
						'macro2',
						'macro3',
						'macro4',
						'macro5',
						'macro6',
						'macro7',
						'macro8',
						'macro-stop1',
						'stopall',
						'image-store1',
						'image-input1',
						'master-run',
						'pgm-black',
						'emem0',
						'master-emem999',
						'pgm-both-emem990',
						'me3-emem999',
						'pgm-pri-emem999',
						'cut-pgm',
						'auto-pgm',
						'panel-memory1',
						'gpi1',
						'pbus-recall',
						'pbus-trigger',
						'button-map',
						'raw-cpl',
					],
				},
			],
		},
	]
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		connection: {
			type: 'simple',
			name: 'Suite Connection (live state)',
			style: { text: 'Not\nConnected', size: 10, color: 0xffffff, bgcolor: 0xa80000 },
			steps: [{ down: [{ actionId: 'connection_toggle', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'connection_state', options: {} }],
		},
		macro1: {
			type: 'simple',
			name: 'Macro 1',
			style: { text: 'Macro\n1', size: 10, color: 0xffffff, bgcolor: 0x285b0b },
			steps: [{ down: [{ actionId: 'macro_play', options: { value: 1 } }], up: [] }],
			feedbacks: [{ feedbackId: 'macro_active', options: { macro: 1 }, style: { bgcolor: 0xffa500, color: 0x000000 } }],
		},
		'macro-stop1': {
			type: 'simple',
			name: 'Stop Macro 1',
			style: { text: 'STOP\nMACRO 1', size: 10, color: 0xffffff, bgcolor: 0x8b0000 },
			steps: [{ down: [{ actionId: 'macro_stop', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		stopall: {
			type: 'simple',
			name: 'Stop all macros',
			style: { text: 'STOP\nALL', size: 10, color: 0xffffff, bgcolor: 0xaa0000 },
			steps: [{ down: [{ actionId: 'macro_stop_all', options: {} }], up: [] }],
			feedbacks: [],
		},
		emem0: {
			type: 'simple',
			name: 'Master E-MEM 0',
			style: { text: 'MASTER\nE-MEM 0', size: 10, color: 0xffffff, bgcolor: 0xd65f00 },
			steps: [{ down: [{ actionId: 'emem', options: { target: 'MASTER', register: 0 } }], up: [] }],
			feedbacks: [],
		},
		'pgm-black': {
			type: 'simple',
			name: 'PGM A Black',
			style: { text: 'PGM A\nBLACK', size: 10, color: 0xffffff, bgcolor: 0x222222 },
			steps: [{ down: [{ actionId: 'crosspoint', options: { target: 'PGM_A', source: 740 } }], up: [] }],
			feedbacks: [],
		},
		'aux1-source9': {
			type: 'simple',
			name: 'AUX 1 Source 9',
			style: { text: 'Aux:1\nSrc:9', size: 10, color: 0xffffff, bgcolor: 0x5c005c },
			steps: [{ down: [{ actionId: 'aux_route', options: { aux: 1, source: 9, transition: 'cut' } }], up: [] }],
			feedbacks: [],
		},
		'cut-pgm': {
			type: 'simple',
			name: 'PGM Primary Cut',
			style: { text: 'PGM PRI\nCUT', size: 10, color: 0xffffff, bgcolor: 0xaa0000 },
			steps: [{ down: [{ actionId: 'transition', options: { target: 'PGM_PRI', transition: 'cut' } }], up: [] }],
			feedbacks: [],
		},
		'auto-pgm': {
			type: 'simple',
			name: 'PGM Primary Auto',
			style: { text: 'PGM PRI\nAUTO', size: 10, color: 0x000000, bgcolor: 0xffd000 },
			steps: [{ down: [{ actionId: 'transition', options: { target: 'PGM_PRI', transition: 'auto' } }], up: [] }],
			feedbacks: [],
		},
		'panel-memory1': {
			type: 'simple',
			name: 'Panel Memory 1',
			style: { text: 'PANEL\nMEM 1', size: 10, color: 0xffffff, bgcolor: 0x3a506b },
			steps: [{ down: [{ actionId: 'panel_memory', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		'image-store1': {
			type: 'simple',
			name: 'Image Store 1',
			style: { text: 'IMAGE\nSTORE 1', size: 10, color: 0xffffff, bgcolor: 0x6a4c93 },
			steps: [{ down: [{ actionId: 'image_store', options: { output: 1, image: 1 } }], up: [] }],
			feedbacks: [],
		},
		'image-input1': {
			type: 'simple',
			name: 'Image Store Input 1',
			style: { text: 'IMAGE IN\n1', size: 10, color: 0xffffff, bgcolor: 0x6a4c93 },
			steps: [{ down: [{ actionId: 'image_store_input', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		'master-run': {
			type: 'simple',
			name: 'Master Timeline RUN',
			style: { text: 'MASTER\nRUN', size: 10, color: 0x000000, bgcolor: 0xffd000 },
			steps: [{ down: [{ actionId: 'run', options: { target: 'MASTER' } }], up: [] }],
			feedbacks: [],
		},
		gpi1: {
			type: 'simple',
			name: 'GPI 1',
			style: { text: 'GPI\n1', size: 10, color: 0xffffff, bgcolor: 0xf77f00 },
			steps: [{ down: [{ actionId: 'gpi', options: { value: 1 } }], up: [] }],
			feedbacks: [],
		},
		'pbus-recall': {
			type: 'simple',
			name: 'PBUS 1 Recall 0',
			style: { text: 'PBUS 1\nRECALL 0', size: 10, color: 0x000000, bgcolor: 0xffbf00 },
			steps: [{ down: [{ actionId: 'pbus_recall', options: { pbus: 1, register: 0 } }], up: [] }],
			feedbacks: [],
		},
		'pbus-trigger': {
			type: 'simple',
			name: 'PBUS 1 Trigger 0',
			style: { text: 'PBUS 1\nTRIGGER 0', size: 10, color: 0x000000, bgcolor: 0xffbf00 },
			steps: [{ down: [{ actionId: 'pbus_trigger', options: { pbus: 1, trigger: 0 } }], up: [] }],
			feedbacks: [],
		},
		'button-map': {
			type: 'simple',
			name: 'Map PGM Shift 1 Button 1',
			style: { text: 'MAP PGM\nS1 B1→1', size: 10, color: 0x000000, bgcolor: 0x39ff14 },
			steps: [
				{ down: [{ actionId: 'button_mapping', options: { bus: 'program', shift: 1, button: 1, source: 1 } }], up: [] },
			],
			feedbacks: [],
		},
		'raw-cpl': {
			type: 'simple',
			name: 'Raw CPL Command',
			style: { text: 'RAW\nCPL', size: 10, color: 0xffffff, bgcolor: 0x333333 },
			steps: [{ down: [{ actionId: 'raw_cpl', options: { command: '' } }], up: [] }],
			feedbacks: [],
		},
	}
	for (let macro = 2; macro <= 8; macro++) {
		presets[`macro${macro}`] = {
			type: 'simple',
			name: `Macro ${macro}`,
			style: { text: `Macro\n${macro}`, size: 10, color: 0xffffff, bgcolor: 0x285b0b },
			steps: [{ down: [{ actionId: 'macro_play', options: { value: macro } }], up: [] }],
			feedbacks: [{ feedbackId: 'macro_active', options: { macro }, style: { bgcolor: 0xffa500, color: 0x000000 } }],
		}
	}
	for (const [aux, source] of [
		[2, 17],
		[3, 17],
		[4, 17],
	] as const) {
		presets[`aux${aux}-source${source}`] = {
			type: 'simple',
			name: `AUX ${aux} Source ${source}`,
			style: { text: `Aux:${aux}\nSrc:${source}`, size: 10, color: 0xffffff, bgcolor: 0x5c005c },
			steps: [{ down: [{ actionId: 'aux_route', options: { aux, source, transition: 'cut' } }], up: [] }],
			feedbacks: [],
		}
	}
	for (const [id, name, target, register] of [
		['master-emem999', 'Master E-MEM 999', 'MASTER', 999],
		['pgm-both-emem990', 'PGM Both E-MEM 990', 'PGM-BOTH', 990],
		['me3-emem999', 'ME3 Primary E-MEM 999', 'ME3-PRI', 999],
		['pgm-pri-emem999', 'PGM Primary E-MEM 999', 'PGM-PRI', 999],
	] as const) {
		presets[id] = {
			type: 'simple',
			name,
			style: { text: name.replace(' E-MEM ', '\nEMEM\n'), size: 10, color: 0xffffff, bgcolor: 0xb72c00 },
			steps: [{ down: [{ actionId: 'emem', options: { target, register } }], up: [] }],
			feedbacks: [],
		}
	}
	self.setPresetDefinitions(structure, presets)
}
