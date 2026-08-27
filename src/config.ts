import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	suite: string
	autoConnect: boolean
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP',
			width: 8,
			regex: Regex.IP,
		},
		{
			type: 'dropdown',
			id: 'suite',
			label: 'Switcher Suite',
			width: 4,
			default: 'suite1a',
			choices: [
				{ id: 'suite1a', label: 'Suite 1' },
				{ id: 'suite2a', label: 'Suite 2' },
				{ id: 'suite3a', label: 'Suite 3' },
				{ id: 'suite4a', label: 'Suite 4' },
			],
		},
		{
			type: 'checkbox',
			id: 'autoConnect',
			label: 'Connect automatically',
			width: 4,
			default: true,
		},
	]
}
