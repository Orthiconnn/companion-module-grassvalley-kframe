import type ModuleInstance from './main.js'
import { buttonStyle, requireSuiteId } from './main.js'
import { ME_INDEXES } from './mix-effects.js'
import { buildButtonMapping, buildGpi, buildPbusRecall, buildPbusTrigger, PBUS_TRIGGERS } from './cpl-commands.js'

type SuiteOption = { suite?: string; textSize?: number; showSuite?: boolean }
type NumberOption = { options: SuiteOption & { value: number; labelOverride?: string } }
type SuiteOnly = { options: SuiteOption }

export type ActionsSchema = {
	connect: SuiteOnly
	disconnect: SuiteOnly
	connection_toggle: SuiteOnly
	macro_play: NumberOption
	macro_stop: NumberOption
	macro_stop_all: SuiteOnly
	aux_route: { options: SuiteOption & { aux: number; source: number; transition: string; labelOverride?: string } }
	crosspoint: { options: SuiteOption & { target: string; source: number; labelOverride?: string } }
	emem: { options: SuiteOption & { target: string; register: number; labelOverride?: string } }
	transition: { options: SuiteOption & { target: string; transition: string; labelOverride?: string } }
	panel_memory: NumberOption
	image_store: { options: SuiteOption & { output: number; image: number; labelOverride?: string } }
	image_store_input: NumberOption
	raw_cpl: { options: SuiteOption & { command: string } }
	run: { options: SuiteOption & { target: string; labelOverride?: string } }
	timeline_edit: { options: SuiteOption & { target: string; command: string; labelOverride?: string } }
	gpi: NumberOption
	pbus_recall: { options: SuiteOption & { pbus: number; register: number; labelOverride?: string } }
	pbus_trigger: { options: SuiteOption & { pbus: number; trigger: number; labelOverride?: string } }
	button_mapping: {
		options: SuiteOption & { bus: string; shift: number; button: number; source: number; labelOverride?: string }
	}
}

const crosspointChoices = Object.keys(ME_INDEXES).flatMap((me) => [
	...['A', 'B', 'C', 'D'].map((bus) => ({ id: `${me}_${bus}`, label: `${me} ${bus}` })),
	...Array.from({ length: 6 }, (_, index) => ({ id: `${me}_K${index + 1}`, label: `${me} Key ${index + 1}` })),
])
const transitionChoices = Object.keys(ME_INDEXES).flatMap((me) => [
	{ id: `${me}_PRI`, label: `${me} Primary` },
	{ id: `${me}_SEC`, label: `${me} Secondary` },
	{ id: `${me}_BOTH`, label: `${me} Both` },
	...Array.from({ length: 6 }, (_, index) => ({ id: `${me}_KEY${index + 1}`, label: `${me} Key ${index + 1}` })),
])
const ememChoices = [
	{ id: 'MASTER', label: 'Master' },
	...Object.keys(ME_INDEXES).flatMap((me) =>
		['PRI', 'SEC', 'BOTH'].map((mode) => ({ id: `${me}-${mode}`, label: `${me} ${mode}` })),
	),
	...['PRI', 'SEC', 'BOTH'].map((mode) => ({ id: `eDPM-${mode}`, label: `eDPM ${mode}` })),
]
const timelineTargetChoices = [
	{ id: 'MASTER', label: 'Master' },
	...Object.keys(ME_INDEXES).map((me) => ({ id: me, label: me })),
	{ id: 'eDPM', label: 'eDPM' },
]
const timelineRunTargetChoices = [
	{ id: 'MASTER', label: 'Master' },
	...Object.keys(ME_INDEXES).flatMap((me) =>
		['PRI', 'SEC', 'BOTH'].map((mode) => ({ id: `${me}-${mode}`, label: `${me} ${mode}` })),
	),
	...['PRI', 'SEC', 'BOTH'].map((mode) => ({ id: `eDPM-${mode}`, label: `eDPM ${mode}` })),
]
const CROSSPOINT_TARGETS = choiceIds(crosspointChoices)
const TRANSITION_TARGETS = choiceIds(transitionChoices)
const EMEM_TARGETS = choiceIds(ememChoices)
const TIMELINE_TARGETS = choiceIds(timelineTargetChoices)
const RUN_TARGETS = choiceIds(timelineRunTargetChoices)
const timelineCommands: Record<string, { eid: number; data: number[] }> = {
	previous: { eid: 0x006b, data: [0x01, 0xff, 0xff] },
	next: { eid: 0x006b, data: [0x01, 0x00, 0x01] },
	insert_before: { eid: 0x006c, data: [0x00] },
	insert_after: { eid: 0x006c, data: [0x01] },
	go_beginning: { eid: 0x006b, data: [0x04] },
	go_end: { eid: 0x006b, data: [0x05] },
	mod: { eid: 0x006d, data: [0x00] },
	mod_all: { eid: 0x006d, data: [0x01] },
	mod_all_absolute: { eid: 0x006d, data: [0x02] },
}

// Commands accept only a finite number or a plain decimal string. Anything else
// (blank, null, true, "0x10", "12.5") becomes NaN, which every command rejects,
// instead of a live value such as E-MEM 0 or Macro 1.
const commandNumber = (value: unknown): number =>
	typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN
// Dropdown targets must be exactly one of the action's own choices.
function choiceIds(choices: readonly { id: string }[]): ReadonlySet<string> {
	return new Set(choices.map((choice) => choice.id))
}
const requireChoice = (value: unknown, allowed: ReadonlySet<string>, what: string): string => {
	const text = String(value)
	if (!allowed.has(text)) throw new Error(`Invalid ${what} ${JSON.stringify(value)}`)
	return text
}

// Display only: empty, zero or non-numeric options fall back to the action's first value.
const optionNumber = (value: unknown, fallback = 1): number => Number(value) || fallback
const pbusValue = (value: unknown): number => {
	const number = Number(value)
	return Number.isInteger(number) && number >= 0 ? number : 0
}
const actionLabel = (
	kind: 'macro_stop' | 'run' | 'timeline_edit',
	options: { value?: unknown; target?: unknown; command?: unknown },
) => ({
	kind,
	macro: optionNumber(options.value),
	target: typeof options.target === 'string' ? options.target : 'MASTER',
	command: typeof options.command === 'string' ? options.command : '',
})

function resultOrThrow(result: { success: boolean; message: string }): void {
	if (!result.success) throw new Error(result.message)
}

const TRANSITION_EVENTS: Partial<Record<string, number>> = { cut: 0x44, auto: 0x43 }

export function UpdateActions(self: ModuleInstance): void {
	const p = self.protocol
	const auxSourceChoices = self.sourceChoices(850)
	const crosspointSourceChoices = self.sourceChoices(809)
	const macroChoices = self.macroChoices()
	const labelOverrideOption = {
		id: 'labelOverride' as const,
		type: 'textinput' as const,
		label: 'Text label override',
		default: '',
		useVariables: true,
	}
	const textSizeOption = {
		id: 'textSize' as const,
		type: 'number' as const,
		label: 'Text size (%)',
		default: 100,
		min: 50,
		max: 200,
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
	const showSuiteOption = {
		id: 'showSuite' as const,
		type: 'checkbox' as const,
		label: 'Show Suite Dot',
		default: true,
	}
	const id = (e: { options: { suite?: string } }) => self.connectionId(requireSuiteId(e.options.suite))
	// Companion fails an action call after a few seconds, but a handshake can take
	// up to 20 s. Start the connection and report its failure in the log instead.
	const connectInBackground = (suite: unknown): void => {
		self.connectSuite(suite).catch((error: unknown) => self.log('warn', `Connect failed: ${String(error)}`))
	}
	// PBUS sequences are several frames 50 ms apart; two quick presses must not
	// interleave (select PLAY, select STOP, fire, fire), so each suite and PBUS
	// device runs one sequence at a time, in press order.
	const pbusQueues = new Map<string, Promise<void>>()
	const runPbusSequence = async (
		e: { options: { suite?: unknown; pbus?: unknown } },
		sequence: () => Promise<void>,
	): Promise<void> => {
		const key = `${requireSuiteId(e.options.suite)}:${String(e.options.pbus)}`
		const current = (pbusQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(sequence)
		pbusQueues.set(key, current)
		try {
			await current
		} finally {
			if (pbusQueues.get(key) === current) pbusQueues.delete(key)
		}
	}
	const suiteSubscription: {
		optionsToMonitorForSubscribe: ('suite' | 'textSize' | 'showSuite')[]
		subscribe: (action: { id: string; controlId: string; options: SuiteOption }) => void
		unsubscribe: (action: { id: string; controlId: string }) => void
	} = {
		optionsToMonitorForSubscribe: ['suite', 'textSize', 'showSuite'],
		subscribe: (action: { id: string; controlId: string; options: SuiteOption }) =>
			self.trackSuiteButton(action.controlId, action.id, buttonStyle(action.options)),
		unsubscribe: (action: { id: string; controlId: string }) => self.untrackSuiteButton(action.controlId, action.id),
	}
	self.setActionDefinitions({
		connect: {
			name: 'Connection: Connect',
			...suiteSubscription,
			options: [suiteOption, textSizeOption, showSuiteOption],
			callback: (e) => connectInBackground(requireSuiteId(e.options.suite)),
		},
		disconnect: {
			name: 'Connection: Disconnect',
			...suiteSubscription,
			options: [suiteOption, textSizeOption, showSuiteOption],
			callback: async (e) => self.disconnectSuite(requireSuiteId(e.options.suite)),
		},
		connection_toggle: {
			name: 'Connection: Connect / Disconnect',
			...suiteSubscription,
			options: [suiteOption, textSizeOption, showSuiteOption],
			callback: async (e) => {
				const suite = requireSuiteId(e.options.suite),
					status = self.suiteStates[suite].status
				// A press while the previous Disconnect is still closing means connect again.
				if (!self.isSuiteDisconnecting(suite) && (status === 'connected' || status === 'connecting'))
					await self.disconnectSuite(suite)
				else connectInBackground(suite)
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
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'value', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) => self.trackButton(self.macroButtons, action, { macro: optionNumber(action.options.value) }),
			unsubscribe: (action) => self.untrackButton(self.macroButtons, action),
			callback: (e) => {
				const macro = commandNumber(e.options.value)
				resultOrThrow(p.sendMacro(id(e), macro))
				self.setVariableValues({ last_macro: macro })
			},
		},
		macro_stop: {
			name: 'Macro: Stop',
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
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'value', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.actionLabelButtons, action, actionLabel('macro_stop', action.options)),
			unsubscribe: (action) => self.untrackButton(self.actionLabelButtons, action),
			callback: (e) => resultOrThrow(p.sendMacroStop(id(e), commandNumber(e.options.value))),
		},
		macro_stop_all: {
			name: 'Macro: Stop All',
			...suiteSubscription,
			options: [suiteOption, textSizeOption, showSuiteOption],
			callback: (e) => resultOrThrow(p.sendMacroStopAll(id(e))),
		},
		aux_route: {
			name: 'AUX: Route Source',
			optionsToMonitorForSubscribe: ['suite', 'aux', 'source', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.auxButtons, action, {
					aux: optionNumber(action.options.aux),
					source: optionNumber(action.options.source),
				}),
			unsubscribe: (action) => self.untrackButton(self.auxButtons, action),
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
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			callback: (e) => {
				const aux = commandNumber(e.options.aux),
					source = commandNumber(e.options.source)
				resultOrThrow(p.sendAuxRoute(id(e), aux, source, String(e.options.transition)))
				self.setVariableValues({ last_aux: aux, last_aux_source: source })
			},
		},
		crosspoint: {
			name: 'Crosspoint: Route Source',
			optionsToMonitorForSubscribe: ['suite', 'target', 'source', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.crosspointButtons, action, {
					target: String(action.options.target),
					source: optionNumber(action.options.source),
				}),
			unsubscribe: (action) => self.untrackButton(self.crosspointButtons, action),
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
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			callback: (e) => {
				const [me, bus] = requireChoice(e.options.target, CROSSPOINT_TARGETS, 'crosspoint target').split('_')
				if (typeof e.options.source !== 'number' && typeof e.options.source !== 'string')
					throw new Error('Invalid source number (must be a whole number from 1-809).')
				const index = ME_INDEXES[me]
				if (index === undefined || !bus) throw new Error('Invalid crosspoint target')
				const key = /^K([1-6])$/.exec(bus)
				const offset = key ? (Number(key[1]) - 1) * 0x10 : ['A', 'B', 'C', 'D'].indexOf(bus) * 0x10
				if (offset < 0) throw new Error('Invalid crosspoint bus')
				resultOrThrow(
					p.sendCrosspoint(
						id(e),
						key ? 0x103a : 0x104a,
						(key ? 0x08000000 : 0x04000000) + offset + index,
						commandNumber(e.options.source),
					),
				)
			},
		},
		emem: {
			name: 'E-MEM: Recall',
			optionsToMonitorForSubscribe: ['suite', 'target', 'register', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.ememButtons, action, {
					target: String(action.options.target),
					register: optionNumber(action.options.register, 0),
				}),
			unsubscribe: (action) => self.untrackButton(self.ememButtons, action),
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Target', default: 'MASTER', choices: ememChoices },
				{ id: 'register', type: 'number', label: 'Register', default: 0, min: 0, max: 999 },
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			callback: (e) => {
				const target = requireChoice(e.options.target, EMEM_TARGETS, 'E-MEM target'),
					register = commandNumber(e.options.register)
				if (target === 'MASTER') return resultOrThrow(p.sendEMem(id(e), register))
				const [me, modeName] = target.split('-')
				const index = me === 'eDPM' ? 10 : ME_INDEXES[me]
				const mode = { PRI: 0, SEC: 1, BOTH: 2 }[modeName]
				if (index === undefined || mode === undefined) throw new Error('Invalid E-MEM target')
				resultOrThrow(p.sendEMemTargeted(id(e), register, 0x02000000 + index, mode))
			},
		},
		transition: {
			name: 'Transition: Cut / Auto',
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
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'target', 'transition', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.transitionButtons, action, {
					target: String(action.options.target),
					transition: String(action.options.transition),
				}),
			unsubscribe: (action) => self.untrackButton(self.transitionButtons, action),
			callback: (e) => {
				const [me, bus] = requireChoice(e.options.target, TRANSITION_TARGETS, 'transition target').split('_')
				const index = ME_INDEXES[me]
				if (index === undefined || !bus) throw new Error('Invalid transition target')
				// Reject anything else rather than firing an AUTO transition on air.
				const eventId = TRANSITION_EVENTS[String(e.options.transition)]
				if (eventId === undefined) throw new Error('Invalid transition type (cut or auto)')
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
			options: [
				suiteOption,
				{ id: 'value', type: 'number', label: 'Register', default: 1, min: 1, max: 99 },
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'value', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.panelMemoryButtons, action, { register: optionNumber(action.options.value) }),
			unsubscribe: (action) => self.untrackButton(self.panelMemoryButtons, action),
			callback: (e) => resultOrThrow(p.sendPanelMem(id(e), commandNumber(e.options.value))),
		},
		image_store: {
			name: 'Image Store: Select Image',
			options: [
				suiteOption,
				{ id: 'output', type: 'number', label: 'Output', default: 1, min: 1, max: 10 },
				{ id: 'image', type: 'number', label: 'Image', default: 1, min: 1, max: 8999 },
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'output', 'image', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.imageStoreButtons, action, {
					output: optionNumber(action.options.output),
					image: optionNumber(action.options.image),
				}),
			unsubscribe: (action) => self.untrackButton(self.imageStoreButtons, action),
			callback: (e) =>
				resultOrThrow(p.sendImageStore(id(e), commandNumber(e.options.output), commandNumber(e.options.image))),
		},
		image_store_input: {
			name: 'Image Store: Select Input',
			options: [
				suiteOption,
				{
					id: 'value',
					type: 'dropdown',
					label: 'Source',
					default: 1,
					choices: auxSourceChoices,
					allowCustom: true,
					regex: '^([1-9]|[1-9][0-9]|[1-7][0-9]{2}|8[0-4][0-9]|850)$',
					minChoicesForSearch: 8,
				},
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'value', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.imageStoreInputButtons, action, { source: optionNumber(action.options.value) }),
			unsubscribe: (action) => self.untrackButton(self.imageStoreInputButtons, action),
			callback: (e) => resultOrThrow(p.sendImageStoreInput(id(e), commandNumber(e.options.value))),
		},
		raw_cpl: {
			name: 'Advanced: Send Raw CPL',
			...suiteSubscription,
			options: [
				suiteOption,
				{ id: 'command', type: 'textinput', label: 'Hex command', default: '' },
				textSizeOption,
				showSuiteOption,
			],
			callback: (e) => resultOrThrow(p.sendRawCommand(id(e), String(e.options.command))),
		},
		run: {
			name: 'Timeline: RUN',
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Target', default: 'MASTER', choices: timelineRunTargetChoices },
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'target', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) => self.trackButton(self.actionLabelButtons, action, actionLabel('run', action.options)),
			unsubscribe: (action) => self.untrackButton(self.actionLabelButtons, action),
			callback: (e) => {
				const target = requireChoice(e.options.target, RUN_TARGETS, 'timeline RUN target')
				const [engine, partition] = target.split('-')
				const did = target === 'MASTER' ? 0x35000001 : 0x02000000 + (engine === 'eDPM' ? 10 : ME_INDEXES[engine])
				if (!Number.isInteger(did)) throw new Error('Invalid timeline RUN target')
				const mode = { PRI: 0, SEC: 1, BOTH: 2 }[partition]
				if (target !== 'MASTER' && mode === undefined) throw new Error('Invalid timeline RUN partition')
				const data: number[] = target === 'MASTER' ? [] : [mode as number]
				resultOrThrow(p.sendTimelineEvent(id(e), 0x0002, did, data))
			},
		},
		timeline_edit: {
			name: 'Timeline: Edit / Navigate',
			options: [
				suiteOption,
				{ id: 'target', type: 'dropdown', label: 'Target', default: 'MASTER', choices: timelineTargetChoices },
				{
					id: 'command',
					type: 'dropdown',
					label: 'Command',
					default: 'next',
					choices: [
						{ id: 'previous', label: 'Previous Keyframe' },
						{ id: 'next', label: 'Next Keyframe' },
						{ id: 'insert_before', label: 'Insert Before' },
						{ id: 'insert_after', label: 'Insert After' },
						{ id: 'go_beginning', label: 'Go to Beginning' },
						{ id: 'go_end', label: 'Go to End' },
						{ id: 'mod', label: 'Mod' },
						{ id: 'mod_all', label: 'Mod All' },
						{ id: 'mod_all_absolute', label: 'Mod All Absolute' },
					],
				},
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'target', 'command', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.actionLabelButtons, action, actionLabel('timeline_edit', action.options)),
			unsubscribe: (action) => self.untrackButton(self.actionLabelButtons, action),
			callback: (e) => {
				const command = timelineCommands[String(e.options.command)]
				if (!command) throw new Error('Invalid timeline command')
				const target = requireChoice(e.options.target, TIMELINE_TARGETS, 'timeline target')
				const did = target === 'MASTER' ? 0x35000001 : 0x02000000 + (target === 'eDPM' ? 10 : ME_INDEXES[target])
				if (!Number.isInteger(did)) throw new Error('Invalid timeline target')
				resultOrThrow(p.sendTimelineEvent(id(e), command.eid, did, command.data))
			},
		},
		gpi: {
			name: 'GPI: Fire',
			options: [
				suiteOption,
				{ id: 'value', type: 'number', label: 'GPI', default: 1, min: 1, max: 40 },
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'value', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) => self.trackButton(self.gpiButtons, action, { gpi: optionNumber(action.options.value) }),
			unsubscribe: (action) => self.untrackButton(self.gpiButtons, action),
			callback: (e) => resultOrThrow(p.sendRawCommand(id(e), buildGpi(commandNumber(e.options.value)))),
		},
		pbus_recall: {
			name: 'PBUS: Recall Register',
			options: [
				suiteOption,
				{ id: 'pbus', type: 'number', label: 'PBUS', default: 1, min: 1, max: 24 },
				{ id: 'register', type: 'number', label: 'Register', default: 0, min: 0, max: 299 },
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'pbus', 'register', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.pbusButtons, action, {
					pbus: optionNumber(action.options.pbus),
					command: 'recall',
					value: pbusValue(action.options.register),
				}),
			unsubscribe: (action) => self.untrackButton(self.pbusButtons, action),
			callback: async (e) => {
				await runPbusSequence(e, async () => {
					const commands = buildPbusRecall(commandNumber(e.options.pbus), commandNumber(e.options.register))
					resultOrThrow(p.sendRawCommand(id(e), commands[0]))
					await new Promise((resolve) => setTimeout(resolve, 50))
					resultOrThrow(p.sendRawCommand(id(e), commands[1]))
				})
			},
		},
		pbus_trigger: {
			name: 'PBUS: Fire Trigger',
			options: [
				suiteOption,
				{ id: 'pbus', type: 'number', label: 'PBUS', default: 1, min: 1, max: 24 },
				{
					id: 'trigger',
					type: 'dropdown',
					label: 'Trigger (Lance TDC-100B functions)',
					tooltip:
						'The PBus device decides what each trigger does. These labels follow the Lance TDC-100B table (GVG mode).',
					default: 0,
					choices: PBUS_TRIGGERS.map(({ name }, trigger) => ({ id: trigger, label: `${trigger} — ${name}` })),
				},
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: ['suite', 'pbus', 'trigger', 'labelOverride', 'textSize', 'showSuite'],
			subscribe: (action) =>
				self.trackButton(self.pbusButtons, action, {
					pbus: optionNumber(action.options.pbus),
					command: 'trigger',
					value: pbusValue(action.options.trigger),
				}),
			unsubscribe: (action) => self.untrackButton(self.pbusButtons, action),
			callback: async (e) => {
				await runPbusSequence(e, async () => {
					const [clear, select, fire] = buildPbusTrigger(
						commandNumber(e.options.pbus),
						commandNumber(e.options.trigger),
					)
					for (const command of [clear, select, fire, clear]) {
						resultOrThrow(p.sendRawCommand(id(e), command))
						await new Promise((resolve) => setTimeout(resolve, 50))
					}
				})
			},
		},
		button_mapping: {
			name: 'Panel: Map Button to Source',
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
				labelOverrideOption,
				textSizeOption,
				showSuiteOption,
			],
			optionsToMonitorForSubscribe: [
				'suite',
				'bus',
				'shift',
				'button',
				'source',
				'labelOverride',
				'textSize',
				'showSuite',
			],
			subscribe: (action) =>
				self.trackButton(self.mappingButtons, action, {
					bus: String(action.options.bus),
					shift: optionNumber(action.options.shift),
					button: optionNumber(action.options.button),
					source: optionNumber(action.options.source),
				}),
			unsubscribe: (action) => self.untrackButton(self.mappingButtons, action),
			callback: (e) =>
				resultOrThrow(
					p.sendRawCommand(
						id(e),
						buildButtonMapping(
							String(e.options.bus),
							commandNumber(e.options.shift),
							commandNumber(e.options.button),
							commandNumber(e.options.source),
						),
					),
				),
		},
	})
}
