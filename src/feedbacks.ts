import type { CompanionAdvancedFeedbackResult } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ButtonStyle, SuiteButton } from './main.js'
import { suiteId, suiteNumber, suitePorts } from './main.js'
import { CLEAR_BADGE, labeledButtonSvg, SUITE_BADGES, timelineProgressSvg } from './badges.js'
import { PBUS_TRIGGERS } from './cpl-commands.js'
import { ME_COLORS, ME_INDEXES, OTHER_COLORS } from './mix-effects.js'

type SuiteOptions = { suite?: string }
export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: SuiteOptions }
	connection_state: { type: 'advanced'; options: SuiteOptions }
	macro_active: { type: 'boolean'; options: SuiteOptions & { macro: number } }
	macro_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	aux_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	crosspoint_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	image_store_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	image_store_input_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	action_label: { type: 'advanced'; options: { automaticLabel: boolean } }
	panel_memory_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	gpi_button_state: { type: 'advanced'; options: Record<string, never> }
	pbus_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	button_mapping_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	transition_button_state: { type: 'advanced'; options: Record<string, never> }
	emem_button_state: { type: 'advanced'; options: Record<string, never> }
	timeline_progress: { type: 'advanced'; options: SuiteOptions }
	suite_badge: { type: 'advanced'; options: Record<string, never> }
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

export const TIMELINE_EDIT_LABELS: Record<string, string> = {
	previous: 'PREVIOUS',
	next: 'NEXT',
	insert_before: 'INSERT\nBEFORE',
	insert_after: 'INSERT\nAFTER',
	go_beginning: 'GO TO\nBEGINNING',
	go_end: 'GO TO\nEND',
	mod: 'MOD',
	mod_all: 'MOD ALL',
	mod_all_absolute: 'MOD ALL\nABSOLUTE',
}

const MAPPING_BUS_LABELS: Record<string, string> = {
	program: 'PGM',
	me1: 'ME1',
	me2: 'ME2',
	me3: 'ME3',
	me4: 'ME4',
	aux: 'AUX',
}

const fontSize = (textScale: number): number => Math.round(10 * textScale)
const suiteBadge = (button: SuiteButton): string =>
	button.showSuite ? SUITE_BADGES[suiteNumber(button.suite)] : CLEAR_BADGE

// Heading and label drawn into the button image. With automatic labels off the
// user's own text stays and only the suite dot is drawn.
function labeledFace(
	button: ButtonStyle,
	automaticLabel: boolean,
	heading: string,
	label: string,
	color: number,
): CompanionAdvancedFeedbackResult {
	if (!automaticLabel) return { png64: suiteBadge(button), pngalignment: 'center:bottom' }
	return {
		text: '',
		png64: labeledButtonSvg(
			suiteNumber(button.suite),
			heading,
			label,
			color,
			undefined,
			button.textSize,
			button.showSuite,
		),
		pngalignment: 'center:bottom',
	}
}

// Plain button text (left alone when undefined) with the suite dot in the corner.
function textFace(button: ButtonStyle, text: string | undefined): CompanionAdvancedFeedbackResult {
	return {
		...(text === undefined ? {} : { text }),
		png64: suiteBadge(button),
		pngalignment: 'center:bottom',
		size: fontSize(button.textSize),
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		connection_state: {
			name: 'Connection state, port, and heartbeat',
			type: 'advanced',
			options: [suiteOption],
			callback: (feedback) => {
				const id = suiteId(feedback.options.suite),
					state = self.suiteStates[id]
				const actionTextSize = self.primarySuiteButton(feedback.controlId)?.textSize ?? 1
				const [mainPort] = suitePorts(id),
					heartbeat = state.heartbeatFlash ? '●' : '○'
				if (state.status === 'connected') {
					const info = self.protocol.getConnectionInfo(self.connectionId(id))
					const protocolName = (state.protocolName || info?.protocol || 'UDP').toUpperCase()
					const livePort = info?.ports.dynamic || (protocolName === 'TCP' ? 5000 : mainPort)
					return {
						text: `Suite ${suiteNumber(id)}\nConnected\n${protocolName}:${livePort}\n${heartbeat}`,
						bgcolor: 0x287a0b,
						color: 0xffffff,
						size: fontSize(actionTextSize),
						alignment: 'center:center',
					}
				}
				if (state.status === 'connecting')
					return {
						text: `Suite ${suiteNumber(id)}\nConnecting\n${state.connectionPhase === 'handshake' ? 'Handshake' : 'Establishing'}`,
						bgcolor: 0xb88600,
						color: 0xffffff,
						size: fontSize(actionTextSize),
						alignment: 'center:center',
					}
				return {
					text: `Suite ${suiteNumber(id)}\nDisconnected`,
					bgcolor: 0xa80000,
					color: 0xffffff,
					size: fontSize(actionTextSize),
					alignment: 'center:center',
				}
			},
		},
		connected: {
			name: 'Connection is online',
			type: 'boolean',
			options: [suiteOption],
			defaultStyle: { bgcolor: 0x00aa00, color: 0xffffff },
			callback: (feedback) => self.suiteStates[suiteId(feedback.options.suite)].status === 'connected',
		},
		macro_active: {
			name: 'Macro is playing or paused',
			type: 'boolean',
			options: [suiteOption, { id: 'macro', type: 'number', label: 'Macro', default: 1, min: 1, max: 999 }],
			defaultStyle: { bgcolor: 0xffa500, color: 0x000000 },
			callback: (feedback) => {
				const status = self.protocol.getMacroStatus(
					self.connectionId(suiteId(feedback.options.suite)),
					Number(feedback.options.macro),
				)
				return status !== null && status !== 0
			},
		},
		macro_button_state: {
			name: 'Macro button name, suite badge, and active state',
			type: 'advanced',
			options: [
				{
					id: 'automaticLabel',
					type: 'checkbox',
					label: 'Automatically show frame Macro name',
					default: true,
				},
			],
			callback: (feedback) => {
				const assignment = self.macroButtons.get(feedback.controlId)
				if (!assignment) return {}
				const connectionId = self.connectionId(assignment.suite)
				const status = self.protocol.getMacroStatus(connectionId, assignment.macro)
				const runState = self.protocol.getMacroRunState(connectionId)
				const paused = status === 7
				const playing = status !== null && status !== 0 && !paused
				const lastPlayed = !playing && !paused && runState?.lastPlayedMacro === assignment.macro
				const macroName = assignment.labelOverride || self.macroDisplayName(assignment.suite, assignment.macro)
				const bgcolor = paused
					? self.macroFlashOn
						? 0x8ee68e
						: 0x285b0b
					: playing
						? 0xffa500
						: lastPlayed
							? 0x66cc66
							: 0x285b0b
				return {
					...textFace(assignment, feedback.options.automaticLabel ? macroName : undefined),
					bgcolor,
					color: paused ? (self.macroFlashOn ? 0x000000 : 0xffffff) : playing || lastPlayed ? 0x000000 : 0xffffff,
				}
			},
		},
		aux_button_state: {
			name: 'AUX source name, suite badge, and online state',
			type: 'advanced',
			options: [
				{
					id: 'automaticLabel',
					type: 'checkbox',
					label: 'Automatically show frame Source name and number',
					default: true,
				},
			],
			callback: (feedback) => {
				const assignment = self.auxButtons.get(feedback.controlId)
				if (!assignment) return {}
				const connectionId = self.connectionId(assignment.suite)
				const sourceName = self.protocol.resolveSourceDisplayName(connectionId, assignment.source)
				const online = self.protocol.getAuxSource(connectionId, assignment.aux) === assignment.source
				const sourceLabel = assignment.labelOverride || sourceName || String(assignment.source)
				const color = online ? 0x000000 : 0xffffff
				return {
					...labeledFace(assignment, feedback.options.automaticLabel, `AUX ${assignment.aux}`, sourceLabel, color),
					bgcolor: online ? 0xb57edc : 0x5c005c,
					color,
					size: fontSize(assignment.textSize),
					alignment: 'center:center',
				}
			},
		},
		crosspoint_button_state: {
			name: 'Crosspoint source name, suite badge, and high tally',
			type: 'advanced',
			options: [
				{
					id: 'automaticLabel',
					type: 'checkbox',
					label: 'Automatically show frame Source name',
					default: true,
				},
			],
			callback: (feedback) => {
				const assignment = self.crosspointButtons.get(feedback.controlId)
				if (!assignment) return {}
				const [me, bus] = assignment.target.split('_')
				const index = ME_INDEXES[me]
				const keyer = /^K([1-6])$/.exec(bus)
				const busOffset = keyer ? (Number(keyer[1]) - 1) * 0x10 : ['A', 'B', 'C', 'D'].indexOf(bus) * 0x10
				const address = index === undefined || busOffset < 0 ? -1 : index + busOffset
				const connectionId = self.connectionId(assignment.suite)
				const selectedSource =
					address < 0
						? null
						: keyer
							? self.protocol.getKeyerSource(connectionId, address)
							: self.protocol.getMESource(connectionId, address)
				const online = selectedSource !== null && selectedSource === assignment.source
				const sourceName = self.protocol.resolveSourceDisplayName(connectionId, assignment.source)
				const sourceLabel = assignment.labelOverride || sourceName || String(assignment.source)
				const base = ME_COLORS[me] ?? OTHER_COLORS
				const busLabel = /^K([1-6])$/.test(bus) ? `${me} ${bus}` : `${me}${bus}`
				const color = online ? 0xffffff : base.text
				return {
					...labeledFace(assignment, feedback.options.automaticLabel, busLabel, sourceLabel, color),
					bgcolor: online ? 0xff0000 : bus === 'A' ? base.bright : base.dark,
					color,
					size: fontSize(assignment.textSize),
					alignment: 'center:center',
				}
			},
		},
		image_store_button_state: {
			name: 'Image Store output and still label, with loaded tally',
			type: 'advanced',
			options: [
				{ id: 'automaticLabel', type: 'checkbox', label: 'Automatically show output and still', default: true },
			],
			callback: (feedback) => {
				const assignment = self.imageStoreButtons.get(feedback.controlId)
				if (!assignment) return {}
				const liveImage = self.protocol.getImageStoreImage(self.connectionId(assignment.suite), assignment.output)
				// The label is the still this button loads; the tally shows the frame already has it on that output.
				const loaded = liveImage === assignment.image
				const label = assignment.labelOverride || String(assignment.image).padStart(4, '0')
				const color = loaded ? 0x000000 : 0xffffff
				return {
					...labeledFace(assignment, feedback.options.automaticLabel, `IS${assignment.output}`, label, color),
					bgcolor: loaded ? 0xb9a3e3 : 0x6a4c93,
					color,
				}
			},
		},
		image_store_input_state: {
			name: 'Image Store input source name or label override',
			type: 'advanced',
			options: [{ id: 'automaticLabel', type: 'checkbox', label: 'Automatically show input source', default: true }],
			callback: (feedback) => {
				const assignment = self.imageStoreInputButtons.get(feedback.controlId)
				if (!assignment) return {}
				const sourceName = self.protocol.resolveSourceDisplayName(
					self.connectionId(assignment.suite),
					assignment.source,
				)
				const label = assignment.labelOverride || sourceName || String(assignment.source)
				return textFace(assignment, feedback.options.automaticLabel ? `IMAGE IN\n${label}` : undefined)
			},
		},
		panel_memory_button_state: {
			name: 'Panel Memory register label',
			type: 'advanced',
			options: [
				{ id: 'automaticLabel', type: 'checkbox', label: 'Automatically show panel-memory register', default: true },
			],
			callback: (feedback) => {
				const assignment = self.panelMemoryButtons.get(feedback.controlId)
				if (!assignment) return {}
				const label = assignment.labelOverride || String(assignment.register)
				return labeledFace(assignment, feedback.options.automaticLabel, 'PNL MEM', label, 0xffffff)
			},
		},
		gpi_button_state: {
			name: 'GPI number or label override',
			type: 'advanced',
			options: [],
			callback: (feedback) => {
				const assignment = self.gpiButtons.get(feedback.controlId)
				if (!assignment) return {}
				return textFace(assignment, assignment.labelOverride || `GPI\n${assignment.gpi}`)
			},
		},
		pbus_button_state: {
			name: 'PBUS register/trigger or label override',
			type: 'advanced',
			options: [
				{ id: 'automaticLabel', type: 'checkbox', label: 'Automatically show PBUS register or trigger', default: true },
			],
			callback: (feedback) => {
				const assignment = self.pbusButtons.get(feedback.controlId)
				if (!assignment) return {}
				const automaticText = `PBUS ${assignment.pbus}\n${
					assignment.command === 'recall'
						? `RECALL ${assignment.value}`
						: (PBUS_TRIGGERS[assignment.value]?.short ?? `TRIGGER ${assignment.value}`)
				}`
				return textFace(
					assignment,
					feedback.options.automaticLabel ? assignment.labelOverride || automaticText : undefined,
				)
			},
		},
		button_mapping_state: {
			name: 'Button mapping bus/shift/button/source or label override',
			type: 'advanced',
			options: [
				{ id: 'automaticLabel', type: 'checkbox', label: 'Automatically show mapping and source', default: true },
			],
			callback: (feedback) => {
				const assignment = self.mappingButtons.get(feedback.controlId)
				if (!assignment) return {}
				const bus = MAPPING_BUS_LABELS[assignment.bus] ?? assignment.bus.toUpperCase()
				const automaticText = `${bus} MAP\nS${assignment.shift} B${assignment.button}→${assignment.source}`
				return textFace(
					assignment,
					feedback.options.automaticLabel ? assignment.labelOverride || automaticText : undefined,
				)
			},
		},
		transition_button_state: {
			name: 'Transition target/type or label override',
			type: 'advanced',
			options: [],
			callback: (feedback) => {
				const assignment = self.transitionButtons.get(feedback.controlId)
				if (!assignment) return {}
				const target = assignment.target.replace('_', ' ')
				const transition = assignment.transition.toUpperCase()
				const me = assignment.target.split('_')[0]
				const family = ME_COLORS[me] ?? OTHER_COLORS
				const color = family.text
				const meIndex = ME_INDEXES[me]
				const partition = assignment.target.split('_')[1]
				const primaryDid = meIndex === undefined ? -1 : 0x03000000 + meIndex
				const secondaryDid = meIndex === undefined ? -1 : 0x03000010 + meIndex
				const primary =
					primaryDid < 0 ? null : self.protocol.getTransitionTelemetry(self.connectionId(assignment.suite), primaryDid)
				const secondary =
					secondaryDid < 0
						? null
						: self.protocol.getTransitionTelemetry(self.connectionId(assignment.suite), secondaryDid)
				// Only M/E PRI/SEC telemetry is subscribed; keyer targets have none.
				const telemetry =
					partition === 'SEC'
						? secondary
						: partition === 'BOTH'
							? primary?.active
								? primary
								: secondary
							: partition === 'PRI'
								? primary
								: undefined
				return {
					text: '',
					png64: labeledButtonSvg(
						suiteNumber(assignment.suite),
						target,
						assignment.labelOverride || transition,
						color,
						assignment.transition === 'auto' && telemetry
							? { ramp: telemetry.ramp, active: telemetry.active }
							: undefined,
						assignment.textSize,
						assignment.showSuite,
					),
					pngalignment: 'center:bottom',
					bgcolor: assignment.transition === 'auto' ? family.bright : family.dark,
					color,
				}
			},
		},
		emem_button_state: {
			name: 'E-MEM delegate, register, and label override',
			type: 'advanced',
			options: [],
			callback: (feedback) => {
				const assignment = self.ememButtons.get(feedback.controlId)
				if (!assignment) return {}
				const heading = assignment.target === 'MASTER' ? 'MASTER' : assignment.target.replace('-', ' ')
				const me = assignment.target.split('-')[0]
				const background = ME_COLORS[me]
				const color = assignment.target === 'MASTER' ? 0x000000 : (background?.text ?? 0xffffff)
				const secondary = assignment.target.endsWith('-SEC')
				return {
					text: '',
					png64: labeledButtonSvg(
						suiteNumber(assignment.suite),
						heading,
						assignment.labelOverride || String(assignment.register),
						color,
						undefined,
						assignment.textSize,
						assignment.showSuite,
					),
					pngalignment: 'center:bottom',
					color,
					...(assignment.target === 'MASTER'
						? { bgcolor: 0xffffff }
						: background
							? { bgcolor: secondary ? background.dark : background.bright }
							: {}),
				}
			},
		},
		timeline_progress: {
			name: 'Master timeline progress and paused pulse',
			type: 'advanced',
			options: [suiteOption],
			callback: (feedback) => {
				// Follow the button's action like every other button-state feedback;
				// the option is only a fallback for buttons without a tracked action.
				const tracked = self.primarySuiteButton(feedback.controlId)
				const suite = tracked?.suite ?? suiteId(feedback.options.suite)
				const actionTextSize = tracked?.textSize ?? 1
				const showSuite = tracked?.showSuite !== false
				// Only the master timeline reports progress; a Run button aimed at an M/E
				// or eDPM timeline would otherwise show the master's bar.
				const run = self.actionLabelButtons.get(feedback.controlId)
				const masterTimeline = run?.kind !== 'run' || run.target === 'MASTER'
				const state = masterTimeline ? self.protocol.getTimelineState(self.connectionId(suite)) : undefined
				if (
					state?.duration === null ||
					state?.duration === undefined ||
					state.duration <= 0 ||
					state.cursorTime === null
				)
					return {
						png64: suiteBadge({ suite, textSize: actionTextSize, showSuite }),
						pngalignment: 'center:bottom',
						size: fontSize(actionTextSize),
					}
				return {
					png64: timelineProgressSvg(
						suiteNumber(suite),
						state.cursorTime,
						state.duration,
						state.pauseState > 0,
						self.timelinePulsePhase,
						state.pausePoints,
						showSuite,
					),
					pngalignment: 'center:bottom',
					size: fontSize(actionTextSize),
				}
			},
		},
		action_label: {
			name: 'Macro Stop / Timeline Run / Timeline Edit label or label override',
			type: 'advanced',
			options: [
				{
					id: 'automaticLabel',
					type: 'checkbox',
					label: 'Automatically show macro, target, and command',
					default: true,
				},
			],
			callback: (feedback) => {
				const assignment = self.actionLabelButtons.get(feedback.controlId)
				if (!assignment || !feedback.options.automaticLabel) return {}
				const target = assignment.target === 'MASTER' ? 'MASTER' : assignment.target.replace('-', ' ')
				let text: string
				if (assignment.kind === 'macro_stop')
					text = `STOP\n${assignment.labelOverride || self.macroDisplayName(assignment.suite, assignment.macro).toUpperCase()}`
				else if (assignment.kind === 'run') text = assignment.labelOverride || `${target}\nRUN`
				else {
					const command = TIMELINE_EDIT_LABELS[assignment.command] ?? assignment.command.toUpperCase()
					text = assignment.labelOverride || (assignment.target === 'MASTER' ? command : `${target}\n${command}`)
				}
				return { text, size: fontSize(assignment.textSize) }
			},
		},
		suite_badge: {
			name: 'Show suite badge for this button action',
			type: 'advanced',
			options: [],
			callback: (feedback) => {
				const assignments = [...(self.suiteButtons.get(feedback.controlId)?.values() ?? [])].filter(
					(assignment) => assignment.showSuite,
				)
				if (assignments.length === 0) return { png64: CLEAR_BADGE }
				const suites = new Set(assignments.map((assignment) => assignment.suite))
				if (suites.size !== 1) return { png64: CLEAR_BADGE }
				const [suite] = suites
				const size = self.primarySuiteButton(feedback.controlId)?.textSize ?? assignments[0]?.textSize ?? 1
				return { png64: SUITE_BADGES[suiteNumber(suite)], pngalignment: 'center:bottom', size: fontSize(size) }
			},
		},
	})
}
