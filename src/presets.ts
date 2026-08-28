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
	const pbusRecallPresetIds = Array.from({ length: 8 }, (_, index) => `pbus-recall${index + 1}`)
	const pbusTriggerPresetIds = Array.from({ length: 8 }, (_, index) => `pbus-trigger${index + 1}`)
	const gpiPresetIds = Array.from({ length: 32 }, (_, index) => `gpi${index + 1}`)
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
			definitions: [
				'emem-master-0',
				'emem-me1-primary-0',
				'emem-me1-secondary-0',
				'emem-me2-primary-0',
				'emem-me2-secondary-0',
				'emem-me3-primary-0',
				'emem-me3-secondary-0',
				'emem-me4-primary-0',
				'emem-me4-secondary-0',
				'emem-pgm-primary-0',
				'emem-pgm-secondary-0',
			],
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
				'transition-pgm-cut',
				'transition-pgm-auto',
			],
		},
		{
			id: 'pbus',
			name: 'PBUS',
			definitions: [...pbusRecallPresetIds, ...pbusTriggerPresetIds],
		},
		{
			id: 'gpi',
			name: 'GPI',
			definitions: gpiPresetIds,
		},
		{
			id: 'image-store',
			name: 'Image Store',
			definitions: [
				'image-store-output1-image1',
				'image-store-output2-image1',
				'image-store-output3-image1',
				'image-store-output4-image1',
				'image-store-output5-image1',
				'image-store-output6-image1',
				'image-store-output7-image1',
				'image-store-output8-image1',
				'image-store-output9-image1',
				'image-store-output10-image1',
				'image-input1',
			],
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
		'emem-master-0': {
			type: 'simple',
			name: 'Master E-MEM 0',
			style: { text: 'MASTER\nE-MEM 0', size: 10, color: 0x000000, bgcolor: 0xffffff, ...suiteBadgeStyle },
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
		'image-store-output1-image1': {
			type: 'simple',
			name: 'Image Store Output 1 Image 0001',
			style: { text: 'OUT 1\nIMAGE 0001', size: 10, color: 0xffffff, bgcolor: 0x6a4c93, ...suiteBadgeStyle },
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
		'pbus-trigger1': {
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
	for (const family of busFamilies) {
		for (const transition of ['cut', 'auto'] as const) {
			presets[`transition-${family.id}-${transition}`] = {
				type: 'simple',
				name: `${family.label} Program ${transition.toUpperCase()}`,
				style: {
					text: `${family.label} PGM\n${transition.toUpperCase()}`,
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
								options: { suite: 'suite1a', target: `${family.target}_BOTH`, transition },
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
	for (let pbus = 2; pbus <= 8; pbus++) {
		presets[`pbus-trigger${pbus}`] = {
			type: 'simple',
			name: `PBUS ${pbus} Trigger 0`,
			style: { text: `PBUS ${pbus}\nTRIGGER 0`, size: 10, color: 0x000000, bgcolor: 0xffbf00, ...suiteBadgeStyle },
			steps: [{ down: [{ actionId: 'pbus_trigger', options: { suite: 'suite1a', pbus, trigger: 0 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (let output = 2; output <= 10; output++) {
		presets[`image-store-output${output}-image1`] = {
			type: 'simple',
			name: `Image Store Output ${output} Image 0001`,
			style: {
				text: `OUT ${output}\nIMAGE 0001`,
				size: 10,
				color: 0xffffff,
				bgcolor: 0x6a4c93,
				...suiteBadgeStyle,
			},
			steps: [{ down: [{ actionId: 'image_store', options: { suite: 'suite1a', output, image: 1 } }], up: [] }],
			feedbacks: [suiteBadgeFeedback()],
		}
	}
	for (let gpi = 2; gpi <= 32; gpi++) {
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
	for (const family of busFamilies) {
		for (const [modeId, modeLabel, modeTarget] of [
			['primary', 'PRI', 'PRI'],
			['secondary', 'SEC', 'SEC'],
		] as const) {
			presets[`emem-${family.id}-${modeId}-0`] = {
				type: 'simple',
				name: `${family.label} ${modeId === 'primary' ? 'Primary' : 'Secondary'} E-MEM 0`,
				style: {
					text: `${family.label} ${modeLabel}\nE-MEM 0`,
					size: 10,
					color: family.text,
					bgcolor: modeId === 'primary' ? family.bright : family.dark,
					...suiteBadgeStyle,
				},
				steps: [
					{
						down: [
							{
								actionId: 'emem',
								options: { suite: 'suite1a', target: `${family.target}-${modeTarget}`, register: 0 },
							},
						],
						up: [],
					},
				],
				feedbacks: [suiteBadgeFeedback()],
			}
		}
	}
	const referencedPresets = new Set<string>()
	for (const section of structure) {
		for (const presetId of section.definitions) {
			if (typeof presetId !== 'string') continue
			if (!presets[presetId]) throw new Error(`Preset section ${section.id} references missing preset ${presetId}`)
			referencedPresets.add(presetId)
		}
	}
	for (const presetId of Object.keys(presets)) {
		if (!referencedPresets.has(presetId)) throw new Error(`Preset ${presetId} is not reachable from a preset section`)
	}
	self.setPresetDefinitions(structure, presets)
}
