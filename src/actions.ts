import type ModuleInstance from './main.js'
import { suiteId } from './main.js'
import { buildButtonMapping, buildGpi, buildPbusRecall, buildPbusTrigger, buildRun } from './legacy-actions.js'

type SuiteOption = { suite?: string }
type NumberOption = { options: SuiteOption & { value: number } }
type SuiteOnly = { options: SuiteOption }

export type ActionsSchema = {
	connect: SuiteOnly
	disconnect: SuiteOnly
	connection_toggle: SuiteOnly
	macro_play: NumberOption
	macro_stop: NumberOption
	macro_stop_all: SuiteOnly
	aux_route: { options: SuiteOption & { aux: number; source: number; transition: string } }
	crosspoint: { options: SuiteOption & { target: string; source: number } }
	emem: { options: SuiteOption & { target: string; register: number } }
	transition: { options: SuiteOption & { target: string; transition: string } }
	panel_memory: NumberOption
	image_store: { options: SuiteOption & { output: number; image: number } }
	image_store_input: NumberOption
	raw_cpl: { options: SuiteOption & { command: string } }
	run: { options: SuiteOption & { target: string } }
	gpi: NumberOption
	pbus_recall: { options: SuiteOption & { pbus: number; register: number } }
	pbus_trigger: { options: SuiteOption & { pbus: number; trigger: number } }
	button_mapping: { options: SuiteOption & { bus: string; shift: number; button: number; source: number } }
}

const meIndexes: Record<string, number> = { PGM: 3, ME1: 0, ME2: 1, ME3: 2, ME4: 4 }
const crosspointChoices = Object.keys(meIndexes).flatMap((me) => [
	...['A', 'B', 'C', 'D'].map((bus) => ({ id: `${me}_${bus}`, label: `${me} ${bus}` })),
	...Array.from({ length: 6 }, (_, index) => ({ id: `${me}_K${index + 1}`, label: `${me} Key ${index + 1}` })),
])
const transitionChoices = Object.keys(meIndexes).flatMap((me) => [
	{ id: `${me}_PRI`, label: `${me} Primary` },
	{ id: `${me}_SEC`, label: `${me} Secondary` },
	{ id: `${me}_BOTH`, label: `${me} Both` },
	...Array.from({ length: 6 }, (_, index) => ({ id: `${me}_KEY${index + 1}`, label: `${me} Key ${index + 1}` })),
])
const ememChoices = [
	{ id: 'MASTER', label: 'Master' },
	...Object.keys(meIndexes).flatMap((me) =>
		['PRI', 'SEC', 'BOTH'].map((mode) => ({ id: `${me}-${mode}`, label: `${me} ${mode}` })),
	),
	...['PRI', 'SEC', 'BOTH'].map((mode) => ({ id: `eDPM-${mode}`, label: `eDPM ${mode}` })),
]
const runChoices = ememChoices

function resultOrThrow(result: { success: boolean; message: string }): void {
	if (!result.success) throw new Error(result.message)
}

export function UpdateActions(self: ModuleInstance): void {
	const p = self.protocol
	const auxSourceChoices = self.sourceChoices(850)
	const crosspointSourceChoices = self.sourceChoices(809)
	const macroChoices = self.macroChoices()
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
	const id = (e: { options: { suite?: string } }) => self.connectionId(suiteId(e.options.suite))
	const suiteSubscription: {
		optionsToMonitorForSubscribe: 'suite'[]
		subscribe: (action: { id: string; controlId: string; options: SuiteOption }) => void
		unsubscribe: (action: { id: string; controlId: string }) => void
	} = {
		optionsToMonitorForSubscribe: ['suite'],
		subscribe: (action: { id: string; controlId: string; options: SuiteOption }) =>
			self.trackSuiteButton(action.controlId, action.id, action.options.suite),
		unsubscribe: (action: { id: string; controlId: string }) => self.untrackSuiteButton(action.controlId, action.id),
	}
	self.setActionDefinitions({
		connect: {
			name: 'Connection: Connect',
			options: [suiteOption],
			callback: async (e) => self.connectSuite(e.options.suite),
		},
		disconnect: {
			name: 'Connection: Disconnect',
			options: [suiteOption],
			callback: async (e) => self.disconnectSuite(e.options.suite),
		},
		connection_toggle: {
			name: 'Connection: Connect / Disconnect',
			options: [suiteOption],
			callback: async (e) => {
				const suite = suiteId(e.options.suite),
					status = self.suiteStates[suite].status
				return status === 'connected' || status === 'connecting'
					? self.disconnectSuite(suite)
					: self.connectSuite(suite)
			},
		},
		macro_play: {
			name: 'Macro: Play / Continue',
			options: [
				suiteOption,
				{
					id: 'value',
					type: 'dropdown',
					label: 'Macro',
					default: 1,
					choices: macroChoices,
					allowCustom: true,
					regex: '^([1-9]|[1-9][0-9]|[1-9][0-9]{2})$',
					minChoicesForSearch: 8,
				},
			],
			optionsToMonitorForSubscribe: ['suite', 'value'],
			subscribe: (action) => self.trackMacroButton(action.controlId, action.options.suite, action.options.value),
			unsubscribe: (action) => self.untrackMacroButton(action.controlId),
			callback: (e) => resultOrThrow(p.sendMacro(id(e), Number(e.options.value))),
		},
		macro_stop: {
			name: 'Macro: Stop',
			...suiteSubscription,
			options: [
				suiteOption,
				{
					id: 'value',
					type: 'dropdown',
					label: 'Macro',
					default: 1,
					choices: macroChoices,
					allowCustom: true,
					regex: '^([1-9]|[1-9][0-9]|[1-9][0-9]{2})$',
					minChoicesForSearch: 8,
				},
			],
			callback: (e) => resultOrThrow(p.sendMacroStop(id(e), Number(e.options.value))),
		},
		macro_stop_all: {
			name: 'Macro: Stop All',
			...suiteSubscription,
			options: [suiteOption],
			callback: (e) => resultOrThrow(p.sendMacroStopAll(id(e))),
		},
		aux_route: {
			name: 'AUX: Route Source',
			optionsToMonitorForSubscribe: ['suite', 'aux', 'source'],
			subscribe: (action) =>
				self.trackAuxButton(action.controlId, action.options.suite, action.options.aux, action.options.source),
			unsubscribe: (action) => self.untrackAuxButton(action.controlId),
			options: [
				suiteOption,
				{ id: 'aux', type: 'number', label: 'AUX', default: 1, min: 1, max: 96 },
				{
					id: 'source',
					type: 'dropdown',
					label: 'Source',
					default: 1,
					choices: auxSourceChoices,
					allowCustom: true,
					regex: '^([1-9]|[1-9][0-9]|[1-7][0-9]{2}|8[0-4][0-9]|850)$',
					minChoicesForSearch: 8,
				},
				{
					id: 'transition',
					type: 'dropdown',
					label: 'Transition',
					default: 'cut',
					choices: [
						{ id: 'cut', label: 'Cut' },
						{ id: 'mix', label: 'Auto/Mix' },
						{ id: 'wipe', label: 'Wipe' },
					],
				},
			],
			callback: (e) =>
				resultOrThrow(
					p.sendAuxRoute(id(e), Number(e.options.aux), Number(e.options.source), String(e.options.transition)),
				),
		},
		crosspoint: {
			name: 'Crosspoint: Route Source',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Bus / Keyer', default: 'PGM_A', choices: crosspointChoices },
				{
					id: 'source',
					type: 'dropdown',
					label: 'Source',
					default: 1,
					choices: crosspointSourceChoices,
					allowCustom: true,
					regex: '^([1-9]|[1-9][0-9]|[1-7][0-9]{2}|80[0-9])$',
					minChoicesForSearch: 8,
				},
			],
			callback: (e) => {
				const [me, bus] = String(e.options.target).split('_')
				const index = meIndexes[me]
				if (index === undefined || !bus) throw new Error('Invalid crosspoint target')
				const key = /^K([1-6])$/.exec(bus)
				const offset = key ? (Number(key[1]) - 1) * 0x10 : ['A', 'B', 'C', 'D'].indexOf(bus) * 0x10
				if (offset < 0) throw new Error('Invalid crosspoint bus')
				resultOrThrow(
					p.sendCrosspoint(
						id(e),
						key ? 0x103a : 0x104a,
						(key ? 0x08000000 : 0x04000000) + offset + index,
						Number(e.options.source),
					),
				)
			},
		},
		emem: {
			name: 'E-MEM: Recall',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Target', default: 'MASTER', choices: ememChoices },
				{ id: 'register', type: 'number', label: 'Register', default: 0, min: 0, max: 999 },
			],
			callback: (e) => {
				const target = String(e.options.target),
					register = Number(e.options.register)
				if (target === 'MASTER') return resultOrThrow(p.sendEMem(id(e), register))
				const [me, modeName] = target.split('-')
				const index = me === 'eDPM' ? 10 : meIndexes[me]
				const mode = { PRI: 0, SEC: 1, BOTH: 2 }[modeName]
				if (index === undefined || mode === undefined) throw new Error('Invalid E-MEM target')
				resultOrThrow(p.sendEMemTargeted(id(e), register, 0x02000000 + index, mode))
			},
		},
		transition: {
			name: 'Transition: Cut / Auto',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Target', default: 'PGM_PRI', choices: transitionChoices },
				{
					id: 'transition',
					type: 'dropdown',
					label: 'Transition',
					default: 'cut',
					choices: [
						{ id: 'cut', label: 'Cut' },
						{ id: 'auto', label: 'Auto' },
					],
				},
			],
			callback: (e) => {
				const [me, bus] = String(e.options.target).split('_')
				const index = meIndexes[me]
				if (index === undefined || !bus) throw new Error('Invalid transition target')
				const eventId = String(e.options.transition) === 'cut' ? 0x44 : 0x43
				if (bus === 'BOTH') {
					resultOrThrow(p.sendTransitionEvent(id(e), eventId, 0x03000000 + index))
					resultOrThrow(p.sendTransitionEvent(id(e), eventId, 0x03000010 + index))
					return
				}
				const key = /^KEY([1-6])$/.exec(bus)
				const did = key
					? 0x08000000 + (Number(key[1]) - 1) * 0x10 + index
					: 0x03000000 + (bus === 'SEC' ? 0x10 : 0) + index
				resultOrThrow(p.sendTransitionEvent(id(e), eventId, did))
			},
		},
		panel_memory: {
			name: 'Panel Memory: Recall',
			...suiteSubscription,
			options: [suiteOption, { id: 'value', type: 'number', label: 'Register', default: 1, min: 1, max: 99 }],
			callback: (e) => resultOrThrow(p.sendPanelMem(id(e), Number(e.options.value))),
		},
		image_store: {
			name: 'Image Store: Select Image',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'output', type: 'number', label: 'Output', default: 1, min: 1, max: 10 },
				{ id: 'image', type: 'number', label: 'Image', default: 1, min: 1, max: 8999 },
			],
			callback: (e) => resultOrThrow(p.sendImageStore(id(e), Number(e.options.output), Number(e.options.image))),
		},
		image_store_input: {
			name: 'Image Store: Select Input',
			...suiteSubscription,
			options: [suiteOption, { id: 'value', type: 'number', label: 'Input', default: 1, min: 1, max: 850 }],
			callback: (e) => resultOrThrow(p.sendImageStoreInput(id(e), Number(e.options.value))),
		},
		raw_cpl: {
			name: 'Advanced: Send Raw CPL',
			...suiteSubscription,
			options: [suiteOption, { id: 'command', type: 'textinput', label: 'Hex command', default: '' }],
			callback: (e) => resultOrThrow(p.sendRawCommand(id(e), String(e.options.command))),
		},
		run: {
			name: 'Timeline: RUN',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Target', default: 'MASTER', choices: runChoices },
			],
			callback: (e) => resultOrThrow(p.sendRawCommand(id(e), buildRun(String(e.options.target)))),
		},
		gpi: {
			name: 'GPI: Fire',
			...suiteSubscription,
			options: [suiteOption, { id: 'value', type: 'number', label: 'GPI', default: 1, min: 1, max: 40 }],
			callback: (e) => resultOrThrow(p.sendRawCommand(id(e), buildGpi(Number(e.options.value)))),
		},
		pbus_recall: {
			name: 'PBUS: Recall Register',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'pbus', type: 'number', label: 'PBUS', default: 1, min: 1, max: 24 },
				{ id: 'register', type: 'number', label: 'Register', default: 0, min: 0, max: 299 },
			],
			callback: async (e) => {
				const commands = buildPbusRecall(Number(e.options.pbus), Number(e.options.register))
				resultOrThrow(p.sendRawCommand(id(e), commands[0]))
				await new Promise((resolve) => setTimeout(resolve, 50))
				resultOrThrow(p.sendRawCommand(id(e), commands[1]))
			},
		},
		pbus_trigger: {
			name: 'PBUS: Fire Trigger',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'pbus', type: 'number', label: 'PBUS', default: 1, min: 1, max: 24 },
				{ id: 'trigger', type: 'number', label: 'Trigger', default: 0, min: 0, max: 12 },
			],
			callback: async (e) => {
				const [clear, select, fire] = buildPbusTrigger(Number(e.options.pbus), Number(e.options.trigger))
				for (const command of [clear, select, fire, clear]) {
					resultOrThrow(p.sendRawCommand(id(e), command))
					await new Promise((resolve) => setTimeout(resolve, 50))
				}
			},
		},
		button_mapping: {
			name: 'Panel: Map Button to Source',
			...suiteSubscription,
			options: [
				suiteOption,
				{
					id: 'bus',
					type: 'dropdown',
					label: 'Bus',
					default: 'program',
					choices: [
						{ id: 'program', label: 'Program' },
						{ id: 'me1', label: 'M/E 1' },
						{ id: 'me2', label: 'M/E 2' },
						{ id: 'me3', label: 'M/E 3' },
						{ id: 'me4', label: 'M/E 4' },
						{ id: 'aux', label: 'AUX' },
					],
				},
				{ id: 'shift', type: 'number', label: 'Shift', default: 1, min: 1, max: 4 },
				{ id: 'button', type: 'number', label: 'Button', default: 1, min: 1, max: 35 },
				{ id: 'source', type: 'number', label: 'Source', default: 1, min: 1, max: 809 },
			],
			callback: (e) =>
				resultOrThrow(
					p.sendRawCommand(
						id(e),
						buildButtonMapping(
							String(e.options.bus),
							Number(e.options.shift),
							Number(e.options.button),
							Number(e.options.source),
						),
					),
				),
		},
	})
}
