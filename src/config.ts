import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	suite: string
	customPorts: boolean
	mainPort: number
	listenerPort: number
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
			type: 'checkbox',
			id: 'customPorts',
			label: 'Override suite UDP ports',
			width: 4,
			default: false,
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
			type: 'number',
			id: 'mainPort',
			label: 'Custom local main port',
			width: 4,
			min: 1024,
			max: 65535,
			default: 6132,
		},
		{
			type: 'number',
			id: 'listenerPort',
			label: 'Custom local listener port',
			width: 4,
			min: 1024,
			max: 65535,
			default: 6133,
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
