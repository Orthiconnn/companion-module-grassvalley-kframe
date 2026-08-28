import type ModuleInstance from './main.js'
import { suiteId, suiteNumber, suitePorts } from './main.js'
import { CLEAR_BADGE, labeledButtonSvg, SUITE_BADGES, timelineProgressSvg } from './badges.js'

type SuiteOptions = { suite?: string }
export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: SuiteOptions }
	connection_state: { type: 'advanced'; options: SuiteOptions }
	macro_active: { type: 'boolean'; options: SuiteOptions & { macro: number } }
	macro_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	aux_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
	crosspoint_button_state: { type: 'advanced'; options: { automaticLabel: boolean } }
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

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		connection_state: {
			name: 'Connection state, port, and heartbeat',
			type: 'advanced',
			options: [suiteOption],
			callback: (feedback) => {
				const id = suiteId(feedback.options.suite),
					state = self.suiteStates[id]
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
						size: 10,
						alignment: 'center:center',
					}
				}
				if (state.status === 'connecting')
					return {
						text: `Suite ${suiteNumber(id)}\nConnecting\n${state.connectionPhase === 'handshake' ? 'Handshake' : 'Establishing'}`,
						bgcolor: 0xb88600,
						color: 0xffffff,
						size: 10,
						alignment: 'center:center',
					}
				return {
					text: `Suite ${suiteNumber(id)}\nDisconnected`,
					bgcolor: 0xa80000,
					color: 0xffffff,
					size: 10,
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
					...(feedback.options.automaticLabel ? { text: macroName } : {}),
					png64: SUITE_BADGES[suiteNumber(assignment.suite)],
					pngalignment: 'left:bottom',
					bgcolor,
					color: paused ? (self.macroFlashOn ? 0x000000 : 0xffffff) : playing || lastPlayed ? 0x000000 : 0xffffff,
					size: 10,
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
					...(feedback.options.automaticLabel ? { text: '' } : {}),
					png64: feedback.options.automaticLabel
						? labeledButtonSvg(suiteNumber(assignment.suite), `AUX ${assignment.aux}`, sourceLabel, color)
						: SUITE_BADGES[suiteNumber(assignment.suite)],
					pngalignment: feedback.options.automaticLabel ? 'center:bottom' : 'left:bottom',
					bgcolor: online ? 0xb57edc : 0x5c005c,
					color,
					size: 10,
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
				const meIndex: Record<string, number> = { ME1: 0, ME2: 1, ME3: 2, PGM: 3, ME4: 4 }
				const index = meIndex[me]
				const busOffset = ['A', 'B', 'C', 'D'].indexOf(bus) * 0x10
				const address = index === undefined || busOffset < 0 ? -1 : index + busOffset
				const connectionId = self.connectionId(assignment.suite)
				const online = address >= 0 && self.protocol.getMESource(connectionId, address) === assignment.source
				const sourceName = self.protocol.resolveSourceDisplayName(connectionId, assignment.source)
				const sourceLabel = assignment.labelOverride || sourceName || String(assignment.source)
				const baseColors: Record<string, { bright: number; dark: number; color: number }> = {
					ME1: { bright: 0x2e9d55, dark: 0x1d6538, color: 0xffffff },
					ME2: { bright: 0xffd21f, dark: 0xb08c00, color: 0x000000 },
					ME3: { bright: 0xff7a18, dark: 0xa84b00, color: 0x000000 },
					ME4: { bright: 0x9b59b6, dark: 0x633974, color: 0xffffff },
					PGM: { bright: 0xd93636, dark: 0x8d2020, color: 0xffffff },
				}
				const base = baseColors[me] ?? { bright: 0x444444, dark: 0x222222, color: 0xffffff }
				const busLabel = /^K([1-6])$/.test(bus) ? `${me} ${bus}` : `${me}${bus}`
				const color = online ? 0xffffff : base.color
				return {
					...(feedback.options.automaticLabel ? { text: '' } : {}),
					png64: feedback.options.automaticLabel
						? labeledButtonSvg(suiteNumber(assignment.suite), busLabel, sourceLabel, color)
						: SUITE_BADGES[suiteNumber(assignment.suite)],
					pngalignment: feedback.options.automaticLabel ? 'center:bottom' : 'left:bottom',
					bgcolor: online ? 0xff0000 : bus === 'A' ? base.bright : base.dark,
					color,
					size: 10,
					alignment: 'center:center',
				}
			},
		},
		timeline_progress: {
			name: 'Master timeline progress and paused pulse',
			type: 'advanced',
			options: [suiteOption],
			callback: (feedback) => {
				const suite = suiteId(feedback.options.suite)
				const state = self.protocol.getTimelineState(self.connectionId(suite))
				if (
					state?.duration === null ||
					state?.duration === undefined ||
					state.duration <= 0 ||
					state.cursorTime === null
				)
					return { png64: SUITE_BADGES[suiteNumber(suite)], pngalignment: 'left:bottom' }
				return {
					png64: timelineProgressSvg(
						suiteNumber(suite),
						state.cursorTime,
						state.duration,
						state.pauseState > 0,
						self.timelinePulsePhase,
					),
					pngalignment: 'center:bottom',
				}
			},
		},
		suite_badge: {
			name: 'Show suite badge for this button action',
			type: 'advanced',
			options: [],
			callback: (feedback) => {
				const suites = new Set(self.suiteButtons.get(feedback.controlId)?.values() ?? [])
				if (suites.size !== 1) return { png64: CLEAR_BADGE }
				const [suite] = suites
				return { png64: SUITE_BADGES[suiteNumber(suite)], pngalignment: 'left:bottom' }
			},
		},
	})
}
