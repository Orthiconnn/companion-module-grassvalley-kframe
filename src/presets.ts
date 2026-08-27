import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import { SUITE_BADGES } from './badges.js'

export function UpdatePresets(self: ModuleInstance): void {
	const suiteBadgeStyle = { png64: SUITE_BADGES[1], pngalignment: 'left:bottom' as const }
	const suiteBadgeFeedback = () => ({ feedbackId: 'suite_badge' as const, options: {} })
	const busFamilies = [
		{ id: 'me1', target: 'ME1', label: 'ME1', mappingBus: 'me1', bright: 0x2e9d55, dark: 0x1d6538, text: 0xffffff },
		{ id: 'me2', target: 'ME2', label: 'ME2', mappingBus: 'me2', bright: 0xffd21f, dark: 0xb08c00, text: 0x000000 },
		{ id: 'me3', target: 'ME3', label: 'ME3', mappingBus: 'me3', bright: 0xff7a18, dark: 0xa84b00, text: 0x000000 },
		{ id: 'me4', target: 'ME4', label: 'ME4', mappingBus: 'me4', bright: 0x9b59b6, dark: 0x633974, text: 0xffffff },
		{ id: 'pgm', target: 'PGM', label: 'PGM', mappingBus: 'program', bright: 0xd93636, dark: 0x8d2020, text: 0xffffff },
	] as const
	const buttonMappingPresetIds = busFamilies.flatMap((family) =>
		[1, 2, 3, 4].flatMap((shift) => [1, 2, 3].map((button) => `button-map-${family.id}-shift${shift}-button${button}`)),
	)
	const structure: CompanionPresetSection[] = [
		{
			id: 'connections',
			name: 'Connections',
			definitions: ['connection-suite1', 'connection-suite2', 'connection-suite3', 'connection-suite4'],
		},
		{
			id: 'macros',
			name: 'Macros',
			definitions: [
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
			],
		},
		{
			id: 'aux',
			name: 'AUX Buses',
			definitions: ['aux1-source1', 'aux2-source1', 'aux3-source1', 'aux4-source1'],
		},
		{
			id: 'crosspoints',
			name: 'Crosspoints',
			definitions: [
				'crosspoint-me1-a-source1',
				'crosspoint-me1-b-source1',
				'crosspoint-me2-a-source1',
				'crosspoint-me2-b-source1',
				'crosspoint-me3-a-source1',
				'crosspoint-me3-b-source1',
				'crosspoint-me4-a-source1',
				'crosspoint-me4-b-source1',
				'crosspoint-pgm-a-source1',
				'crosspoint-pgm-b-source1',
			],
		},
		{
			id: 'emem',
			name: 'E-MEMs',
			definitions: ['emem0', 'master-emem999', 'pgm-both-emem990', 'me3-emem999', 'pgm-pri-emem999', 'master-run'],
		},
		{
			id: 'transitions',
			name: 'Transitions',
			definitions: [
				'transition-me1-cut',
				'transition-me1-auto',
				'transition-me2-cut',
				'transition-me2-auto',
				'transition-me3-cut',
				'transition-me3-auto',
				'transition-me4-cut',
				'transition-me4-auto',
			],
		},
		{
			id: 'external',
			name: 'PBUS and GPI',
			definitions: [
				'pbus-recall1',
				'pbus-recall2',
				'pbus-recall3',
				'pbus-recall4',
				'pbus-recall5',
				'pbus-recall6',
				'pbus-recall7',
				'pbus-recall8',
				'pbus-trigger',
				'gpi1',
				'gpi2',
				'gpi3',
				'gpi4',
				'gpi5',
				'gpi6',
				'gpi7',
				'gpi8',
				'gpi9',
				'gpi10',
			],
		},
		{
			id: 'image-store',
			name: 'Image Store',
			definitions: ['image-store1', 'image-input1'],
		},
		{
			id: 'button-mapping',
			name: 'Button Mapping',
			definitions: buttonMappingPresetIds,
		},
		{
			id: 'panel-memory',
			name: 'Panel Memory',
			definitions: [
				'panel-memory1',
				'panel-memory2',
				'panel-memory3',
				'panel-memory4',
				'panel-memory5',
				'panel-memory6',
				'panel-memory7',
				'panel-memory8',
			],
		},
	]
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		'connection-suite1': {
			type: 'simple',
			name: 'Suite 1 Connect / Disconnect',
			style: { text: 'Suite 1\nNot\nConnected', size: 10, color: 0xffffff, bgcolor: 0xa80000 },
			steps: [{ down: [{ actionId: 'connection_toggle', options: { suite: 'suite1a' } }], up: [] }],
			feedbacks: [{ feedbackId: 'connection_state', options: { suite: 'suite1a' } }],
		},
		macro1: {
			type: 'simple',
			name: 'Macro 1',
			style: {
				text: 'Macro\n1',
				size: 10,
				color: 0xffffff,
				bgcolor: 0x285b0b,
				png64: SUITE_BADGES[1],
				pngalignment: 'left:bottom',
			},
			steps: [{ down: [{ actionId: 'macro_play', options: { suite: 'suite1a', value: 1 } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'macro_button_state',
					options: { automaticLabel: true },
				},
			],
		},
		'macro-stop1': {
			type: 'simple',
			name: 'Stop Macro 1',
			style: { text: 'STOP\nMACRO 1', size: 10, color: 0xffffff, bgcolor: 0x8b0000, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'macro_stop', options: { suite: 'suite1a', value: 1 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		stopall: {
			type: 'simple',
			name: 'Stop all macros',
			style: { text: 'STOP\nALL', size: 10, color: 0xffffff, bgcolor: 0xaa0000, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'macro_stop_all', options: { suite: 'suite1a' } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		emem0: {
			type: 'simple',
			name: 'Master E-MEM 0',
			style: { text: 'MASTER\nE-MEM 0', size: 10, color: 0xffffff, bgcolor: 0xd65f00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'emem', options: { suite: 'suite1a', target: 'MASTER', register: 0 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		'aux1-source1': {
			type: 'simple',
			name: 'AUX 1 Source 1',
			style: { text: 'AUX 1\nSRC 1', size: 10, color: 0xffffff, bgcolor: 0x5c005c, ...suiteBadgeStyle },
			steps: [
				{
					down: [{ actionId: 'aux_route', options: { suite: 'suite1a', aux: 1, source: 1, transition: 'cut' } }],
					up: [],
				},
			],
			feedbacks: [suiteBadgeFeedback()],
		},
		'panel-memory1': {
			type: 'simple',
			name: 'Panel Memory 1',
			style: { text: 'PANEL\nMEM 1', size: 10, color: 0xffffff, bgcolor: 0x3a506b, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'panel_memory', options: { suite: 'suite1a', value: 1 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		'image-store1': {
			type: 'simple',
			name: 'Image Store 1',
			style: { text: 'IMAGE\nSTORE 1', size: 10, color: 0xffffff, bgcolor: 0x6a4c93, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'image_store', options: { suite: 'suite1a', output: 1, image: 1 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		'image-input1': {
			type: 'simple',
			name: 'Image Store Input 1',
			style: { text: 'IMAGE IN\n1', size: 10, color: 0xffffff, bgcolor: 0x6a4c93, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'image_store_input', options: { suite: 'suite1a', value: 1 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		'master-run': {
			type: 'simple',
			name: 'Master Timeline RUN',
			style: { text: 'MASTER\nRUN', size: 10, color: 0x000000, bgcolor: 0xffd000, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'run', options: { suite: 'suite1a', target: 'MASTER' } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		gpi1: {
			type: 'simple',
			name: 'GPI 1',
			style: { text: 'GPI\n1', size: 10, color: 0xffffff, bgcolor: 0xf77f00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'gpi', options: { suite: 'suite1a', value: 1 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		'pbus-recall1': {
			type: 'simple',
			name: 'PBUS 1 Recall 0',
			style: { text: 'PBUS 1\nRECALL 0', size: 10, color: 0x000000, bgcolor: 0xffbf00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'pbus_recall', options: { suite: 'suite1a', pbus: 1, register: 0 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
		'pbus-trigger': {
			type: 'simple',
			name: 'PBUS 1 Trigger 0',
			style: { text: 'PBUS 1\nTRIGGER 0', size: 10, color: 0x000000, bgcolor: 0xffbf00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'pbus_trigger', options: { suite: 'suite1a', pbus: 1, trigger: 0 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		},
	}
	for (let suite = 2; suite <= 4; suite++) {
		const id = `suite${suite}a`
		presets[`connection-suite${suite}`] = {
			type: 'simple',
			name: `Suite ${suite} Connect / Disconnect`,
			style: { text: `Suite ${suite}\nNot\nConnected`, size: 10, color: 0xffffff, bgcolor: 0xa80000 },
			steps: [{ down: [{ actionId: 'connection_toggle', options: { suite: id } }], up: [] }],
			feedbacks: [{ feedbackId: 'connection_state', options: { suite: id } }],
		}
	}
	for (let macro = 2; macro <= 8; macro++) {
		presets[`macro${macro}`] = {
			type: 'simple',
			name: `Macro ${macro}`,
			style: {
				text: `Macro\n${macro}`,
				size: 10,
				color: 0xffffff,
				bgcolor: 0x285b0b,
				png64: SUITE_BADGES[1],
				pngalignment: 'left:bottom',
			},
			steps: [{ down: [{ actionId: 'macro_play', options: { suite: 'suite1a', value: macro } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'macro_button_state',
					options: { automaticLabel: true },
				},
			],
		}
	}
	for (const aux of [2, 3, 4] as const) {
		const source = 1
		presets[`aux${aux}-source${source}`] = {
			type: 'simple',
			name: `AUX ${aux} Source ${source}`,
			style: { text: `Aux:${aux}\nSrc:${source}`, size: 10, color: 0xffffff, bgcolor: 0x5c005c, ...suiteBadgeStyle },
			steps: [
				{ down: [{ actionId: 'aux_route', options: { suite: 'suite1a', aux, source, transition: 'cut' } }], up: [] },
			],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (const family of busFamilies) {
		for (const side of ['A', 'B'] as const) {
			presets[`crosspoint-${family.id}-${side.toLowerCase()}-source1`] = {
				type: 'simple',
				name: `${family.label} ${side} Source 1`,
				style: {
					text: `${family.label} ${side}\nSRC 1`,
					size: 10,
					color: family.text,
					bgcolor: side === 'A' ? family.bright : family.dark,
					...suiteBadgeStyle,
				},
				steps: [
					{
						down: [
							{
								actionId: 'crosspoint',
								options: { suite: 'suite1a', target: `${family.target}_${side}`, source: 1 },
							},
						],
						up: [],
					},
				],
				feedbacks: [suiteBadgeFeedback()],
			}
		}
	}
	for (const me of [1, 2, 3, 4] as const) {
		const family = busFamilies[me - 1]
		for (const transition of ['cut', 'auto'] as const) {
			presets[`transition-me${me}-${transition}`] = {
				type: 'simple',
				name: `M/E ${me} Program ${transition.toUpperCase()}`,
				style: {
					text: `ME${me} PGM\n${transition.toUpperCase()}`,
					size: 10,
					color: family.text,
					bgcolor: transition === 'auto' ? family.bright : family.dark,
					...suiteBadgeStyle,
				},
				steps: [
					{
						down: [
							{
								actionId: 'transition',
								options: { suite: 'suite1a', target: `ME${me}_BOTH`, transition },
							},
						],
						up: [],
					},
				],
				feedbacks: [suiteBadgeFeedback()],
			}
		}
	}
	for (let pbus = 2; pbus <= 8; pbus++) {
		presets[`pbus-recall${pbus}`] = {
			type: 'simple',
			name: `PBUS ${pbus} Recall 0`,
			style: { text: `PBUS ${pbus}\nRECALL 0`, size: 10, color: 0x000000, bgcolor: 0xffbf00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'pbus_recall', options: { suite: 'suite1a', pbus, register: 0 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (let gpi = 2; gpi <= 10; gpi++) {
		presets[`gpi${gpi}`] = {
			type: 'simple',
			name: `GPI ${gpi}`,
			style: { text: `GPI\n${gpi}`, size: 10, color: 0xffffff, bgcolor: 0xf77f00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'gpi', options: { suite: 'suite1a', value: gpi } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (let register = 2; register <= 8; register++) {
		presets[`panel-memory${register}`] = {
			type: 'simple',
			name: `Panel Memory ${register}`,
			style: {
				text: `PANEL\nMEM ${register}`,
				size: 10,
				color: 0xffffff,
				bgcolor: 0x3a506b,
				...suiteBadgeStyle,
			},
			steps: [{ down: [{ actionId: 'panel_memory', options: { suite: 'suite1a', value: register } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (const family of busFamilies) {
		for (let shift = 1; shift <= 4; shift++) {
			for (let button = 1; button <= 3; button++) {
				presets[`button-map-${family.id}-shift${shift}-button${button}`] = {
					type: 'simple',
					name: `${family.label} Shift ${shift} Button ${button} to Source 1`,
					style: {
						text: `${family.label} MAP\nS${shift} B${button}→1`,
						size: 10,
						color: family.text,
						bgcolor: family.bright,
						...suiteBadgeStyle,
					},
					steps: [
						{
							down: [
								{
									actionId: 'button_mapping',
									options: {
										suite: 'suite1a',
										bus: family.mappingBus,
										shift,
										button,
										source: 1,
									},
								},
							],
							up: [],
						},
					],
					feedbacks: [suiteBadgeFeedback()],
				}
			}
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
			style: {
				text: name.replace(' E-MEM ', '\nEMEM\n'),
				size: 10,
				color: 0xffffff,
				bgcolor: 0xb72c00,
				...suiteBadgeStyle,
			},
			steps: [{ down: [{ actionId: 'emem', options: { suite: 'suite1a', target, register } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (const section of structure) {
		for (const presetId of section.definitions) {
			if (typeof presetId !== 'string') continue
			if (!presets[presetId]) throw new Error(`Preset section ${section.id} references missing preset ${presetId}`)
		}
	}
	self.setPresetDefinitions(structure, presets)
}
